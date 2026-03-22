# Technical Design: Richer Log Entry Metadata

## Motivation

Currently, logs in the workflow JSON upload are plain strings (`"logs": "line1\nline2\n"`). The system splits them by newline at serve time and returns lines with a hardcoded `timestampNs: "0"`. This prevents attaching any per-line metadata — timestamps, severity levels, or structured fields that CI/CD systems already produce.

This design replaces the plain string with an array of **log entry objects**, where each entry represents one rendered log line. The initial metadata field is `timestamp`; the object structure makes future fields (severity, source, etc.) trivial to add without schema migration.

---

## Upload Schema Change

**Before:**

```json
{
  "id": "step-1",
  "logs": "Building...\nDone.\n",
  "steps": []
}
```

**After:**

```json
{
  "id": "step-1",
  "logs": [
    { "timestamp": "2026-03-08T10:00:01Z", "content": "Building..." },
    { "timestamp": "2026-03-08T10:00:02Z", "content": "Done." }
  ],
  "steps": []
}
```

- `logs` changes from `string | null` to `LogEntry[] | null`
- A `LogEntry` has:
  - `content` (string, required): the log line text
  - `timestamp` (string, optional): RFC 3339 UTC timestamp for when the line was emitted
- Leaf steps may have `logs: [...]` or `logs: null` (no logs)
- Non-leaf steps must have `logs: null` (enforced by existing structural validation)

### Backward compatibility

The old string format is **not** supported. All uploaders must send the new array format. This is acceptable because the system is not yet in production and there are no external consumers to migrate.

---

## Database Schema Change

**Before** — `step_logs` stores one row per leaf step with a single `log_text` column:

```
step_logs(workflow_id, step_uuid PK, log_text)
```

**After** — `step_logs` stores one row **per log entry** with structured fields:

```
step_logs(
  id            SERIAL PRIMARY KEY,
  workflow_id   UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_uuid     UUID NOT NULL,
  line_number   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  timestamp     TIMESTAMPTZ,
  INDEX step_logs_by_step_idx (step_uuid, line_number),
  INDEX step_logs_by_workflow_idx (workflow_id)
)
```

Key changes:
- **Primary key** moves from `step_uuid` to an auto-increment `id` (multiple rows per step)
- **`line_number`** preserves insertion order within a step (0-indexed)
- **`content`** replaces `log_text` — stores one line's content, not the full blob
- **`timestamp`** stores the optional per-line timestamp as a native PostgreSQL `timestamptz`
- **`step_uuid` + `line_number`** index supports efficient ordered retrieval per step

### Drizzle schema (`schema.ts`)

```typescript
export const stepLogs = pgTable(
  "step_logs",
  {
    id: serial("id").primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    stepUuid: uuid("step_uuid").notNull(),
    lineNumber: integer("line_number").notNull(),
    content: text("content").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }),
  },
  (table) => [
    index("step_logs_by_step_idx").on(table.stepUuid, table.lineNumber),
    index("step_logs_by_workflow_idx").on(table.workflowId),
  ],
);
```

### Migration

Use `bunx drizzle-kit push` in development. The existing `step_logs` table is dropped and recreated.

---

## Type Changes

### `workflow-server/src/lib/types.ts`

```typescript
export interface LogEntry {
  content: string;
  timestamp?: string;
}

export interface StepInput {
  id: string;
  metadata: Metadata;
  status: string;
  dependsOn: string[];
  logs: LogEntry[] | null;  // was: string | null
  steps: StepInput[];
}

export interface FlatStep {
  // ... existing fields unchanged ...
  logs: LogEntry[] | null;  // was: string | null
}
```

### `ui/src/lib/types.ts`

```typescript
export interface LogLine {
  content: string;          // was: line
  timestamp: string | null; // was: timestampNs (always "0")
  stepPath: string;
  stepId: string;
  depth: string;
}
```

---

## Validation Changes (`validation.ts`)

The Zod schema for `logs` changes from `z.string().nullable()` to:

```typescript
const logEntrySchema = z.object({
  content: z.string(),
  timestamp: z.string().optional(),
});

// In stepSchema:
logs: z.array(logEntrySchema).nullable().default(null),
```

Log size validation changes from `Buffer.byteLength(step.logs)` to summing byte lengths of all entry `content` fields:

```typescript
if (step.logs !== null) {
  const bytes = step.logs.reduce(
    (sum, entry) => sum + Buffer.byteLength(entry.content, "utf8"),
    0,
  );
  // ... same MAX_LOG_BYTES_PER_LEAF / MAX_TOTAL_LOG_BYTES checks
}
```

---

## Upload Pipeline Changes (`db.ts`)

### `flattenSteps()`

The `logs` field on `FlatStep` becomes `LogEntry[] | null` instead of `string | null`. No line splitting at flatten time — entries are stored as-is.

### `insertWorkflow()` — log insertion

Instead of one `stepLogs` row per leaf step, insert one row per log entry:

```typescript
const logRows: (typeof stepLogs.$inferInsert)[] = [];

for (const s of flat) {
  const stepUuid = tempToUuid.get(s.tempId)!;
  if (s.isLeaf && s.logs !== null) {
    for (let i = 0; i < s.logs.length; i++) {
      const entry = s.logs[i];
      logRows.push({
        workflowId: wfId,
        stepUuid,
        lineNumber: i,
        content: entry.content,
        timestamp: entry.timestamp ? new Date(entry.timestamp) : null,
      });
    }
  }
}

// Batch insert (unchanged batch size of 1000)
for (let i = 0; i < logRows.length; i += BATCH) {
  await tx.insert(stepLogs).values(logRows.slice(i, i + BATCH));
}
```

---

## Log Serving Changes (`getLogs` in `db.ts`, `routes/logs.ts`)

### Query

Instead of joining `step_logs` (one row per step) and splitting `log_text` by newline, query individual log entry rows directly:

```typescript
const logEntries = await db
  .select({
    content: stepLogs.content,
    timestamp: stepLogs.timestamp,
    stepId: steps.stepId,
    stepPath: steps.hierarchyPath,
    depth: steps.depth,
    lineNumber: stepLogs.lineNumber,
    sortOrder: steps.sortOrder,
  })
  .from(stepLogs)
  .innerJoin(steps, eq(steps.id, stepLogs.stepUuid))
  .where(
    and(
      eq(steps.workflowId, workflowId),
      eq(steps.isLeaf, true),
      or(
        eq(steps.hierarchyPath, exactPath),
        like(steps.hierarchyPath, prefixPath),
      ),
    ),
  )
  .orderBy(steps.sortOrder, stepLogs.lineNumber);
```

### Response shape

```json
{
  "lines": [
    {
      "content": "Building React app...",
      "timestamp": "2026-03-08T10:00:01Z",
      "stepPath": "/ci/build-frontend",
      "stepId": "build-frontend",
      "depth": "2"
    }
  ],
  "nextCursor": "..."
}
```

Changes:
- `line` → `content`
- `timestampNs` → `timestamp` (ISO string or `null`)
- Cursor pagination is unchanged (base64url-encoded offset) but now offsets into DB rows instead of split-line indices

---

## Frontend Changes

### `LogLine` component (`ui/src/components/LogLine.tsx`)

- Reads `line.content` instead of `line.line`
- Optionally renders `line.timestamp` as a prefix column (formatted in local time, monospace, dimmed color) when present
- Timestamp column is only shown if any line in the current page has a non-null timestamp

### `LogsPage` component (`ui/src/pages/LogsPage.tsx`)

- Filter matches against `line.content` instead of `line.line`
- No other structural changes needed

### `api.ts`

- No changes needed — the response shape change is handled by the updated `LogLine` type

---

## Test Data Changes

All test data files update their `logs` fields from strings to `LogEntry[]` arrays.

**Example** — `simple-linear.json` checkout step:

```json
{
  "id": "checkout",
  "logs": [
    { "timestamp": "2026-03-08T10:00:00Z", "content": "Cloning into repo..." },
    { "timestamp": "2026-03-08T10:00:01Z", "content": "Checked out abc123" }
  ]
}
```

Files to update:
- `tests/data/simple-linear.json`
- `tests/data/nested-hierarchy.json`
- `tests/data/mixed-status.json`
- `tests/data/parallel-diamond.json`
- `tests/data/gen_large_linear.py` — update `make_substeps()` to emit log entry arrays
- Regenerate `tests/data/large-linear.json`

### E2E test updates

Backend tests (`tests/e2e-tests-backend.ts`):
- Log line assertions change from `line.line` to `line.content`
- `line.timestampNs` assertions change to `line.timestamp`
- Content match strings remain the same (e.g., `"Cloning into repo..."`)

Frontend tests (`tests/e2e-tests-frontend.ts`):
- Any assertions on rendered log text adjust for the new timestamp column if visible

---

## Implementation Plan

### Phase 1: Update test data and tests

1. **Update all test data JSON files** — convert `logs` from strings to `LogEntry[]` arrays in `simple-linear.json`, `nested-hierarchy.json`, `mixed-status.json`, `parallel-diamond.json`
2. **Update `gen_large_linear.py`** — modify `make_substeps()` to produce log entry arrays with timestamps, regenerate `large-linear.json`
3. **Update backend E2E tests** — change `line.line` → `line.content`, `line.timestampNs` → `line.timestamp`, keep content match strings the same
4. **Update frontend E2E tests** — adjust any log rendering assertions for the new format

### Phase 2: Server-side changes

5. **Update types** (`workflow-server/src/lib/types.ts`) — add `LogEntry` interface, change `StepInput.logs` and `FlatStep.logs` to `LogEntry[] | null`
6. **Update Zod validation** (`workflow-server/src/lib/validation.ts`) — add `logEntrySchema`, update `stepSchema.logs`, adjust byte-counting logic
7. **Update DB schema** (`workflow-server/src/lib/schema.ts`) — replace `stepLogs` table with per-entry schema (serial PK, `step_uuid`, `line_number`, `content`, `timestamp`)
8. **Push schema** — run `bunx drizzle-kit push` to apply the schema change
9. **Update `flattenSteps()`** (`workflow-server/src/lib/db.ts`) — pass `LogEntry[]` through as-is on `FlatStep.logs`
10. **Update log insertion** (`workflow-server/src/lib/db.ts` `insertWorkflow()`) — insert one row per log entry with `lineNumber`, `content`, `timestamp`
11. **Update `getLogs()`** (`workflow-server/src/lib/db.ts`) — query individual rows, return `content`/`timestamp` instead of splitting `logText`

### Phase 3: Frontend changes

12. **Update frontend types** (`ui/src/lib/types.ts`) — change `LogLine` to use `content`/`timestamp` fields
13. **Update `LogLine` component** — render `content` instead of `line`, optionally show timestamp column
14. **Update `LogsPage` filter** — filter on `content` instead of `line`

### Phase 4: Verify

15. **Run backend E2E tests** — `bun run test:e2e-backend`
16. **Run frontend E2E tests** — `bun run test:e2e-frontend`

---

## Design doc updates

The following design documents need to be updated to reflect this change:

- **`design.md`** (root) — update the workflow JSON upload schema example to show `logs` as an array of objects, update the `logs` field description
- **`workflow-server/design.md`** — update the log storage description, DB schema section, log query SQL, logs response shape, and upload pipeline description
- **`ui/design.md`** — update the `LogLine` type in the shared infrastructure section, update the `LogLine` component spec to describe the timestamp column
