# Schema Optimization: Cascade Delete & Insert Performance

## Problem

Uploading and deleting the large workflow test fixture (`tests/data/large-linear.json`, ~11K steps, ~11K dependencies) is slow:

| Operation | Current Time |
| --------- | ------------ |
| Upload    | ~5.5s        |
| Delete    | ~33s         |

## Root Cause Analysis

### Delete: ~33s → cascade FK trigger storm

When `DELETE FROM workflows WHERE id = ?` runs, PostgreSQL processes cascades **row by row**. The current FK chain is:

```
workflows.id
  ← steps.workflow_id (CASCADE)           -- 11,003 step rows deleted
      ← step_dependencies.step_uuid (CASCADE)       -- checked 11,003 times
      ← step_dependencies.depends_on_uuid (CASCADE)  -- checked 11,003 times, NO INDEX
      ← step_logs.step_uuid (CASCADE)     -- checked 11,003 times
```

Note: `steps.parent_step_id` has no FK constraint (it is a plain UUID column), so it does not participate in the cascade chain.

`EXPLAIN ANALYZE` confirms the trigger costs (measured on live DB):

| Constraint                                | Calls  | Time     |
| ----------------------------------------- | ------ | -------- |
| `steps_workflow_id_fkey`                   | 1      | 11ms     |
| `step_dependencies_step_uuid_fkey`        | 11,003 | 214ms    |
| `step_dependencies_depends_on_uuid_fkey`  | 11,003 | **33,000ms+** |
| `step_logs_step_uuid_fkey`                | 11,003 | 213ms    |
| **Total**                                 |        | **~33.4s** |

Two compounding issues:

1. **Missing index on `depends_on_uuid`**: The composite PK `(step_uuid, depends_on_uuid)` covers lookups by `step_uuid` but NOT by `depends_on_uuid` alone. Every step deletion triggers a sequential scan of the entire `step_dependencies` table to find rows where `depends_on_uuid` matches the deleted step. This accounts for ~33s of the ~33.4s total.

2. **Per-row cascade triggers**: Even with proper indexes, each of the 11,003 step deletions fires 3 separate FK constraint checks (one for each child table). Moving cascades to `workflow_id` collapses these to a single bulk delete per table.

### Experimental validation

Tested incrementally against the live database:

| Change | Delete Time | Speedup |
| ------ | ----------- | ------- |
| Baseline (current schema) | ~33,400ms | — |
| + Add index on `depends_on_uuid` | ~660ms | **~50x** |
| + Move all FKs to `workflow_id` (proposed) | **~54ms** | **~620x** |

*Note: Original measurements were taken on a DB that also had a self-referential FK on `steps.parent_step_id` (since removed). The numbers above are adjusted estimates excluding that constraint's ~1.2s cost.*

### Upload: 5.5s → individual INSERT round-trips

The upload inserts rows one at a time in a loop:

- 11,003 individual `INSERT INTO steps ... RETURNING id` statements
- 10,999 individual `INSERT INTO step_dependencies` statements
- 11,000 individual `INSERT INTO step_logs` statements
- **Total: ~33,000 round-trips** in a single transaction

Each round-trip has overhead from query parsing, planning, and client-server communication, even within a transaction.

---

## Proposed Changes

### 1. Add `workflow_id` to `step_dependencies` and `step_logs`, cascade from workflow

Replace the step-level FK cascades with direct workflow-level cascades. This makes each child table independently deletable by workflow ID in a single bulk operation (calls=1) instead of per-step (calls=N).

**step_dependencies: before**
```sql
CREATE TABLE step_dependencies (
    step_uuid       UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    depends_on_uuid UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    PRIMARY KEY (step_uuid, depends_on_uuid)
);
```

**step_dependencies: after**
```sql
CREATE TABLE step_dependencies (
    workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    step_uuid       UUID NOT NULL,
    depends_on_uuid UUID NOT NULL,
    PRIMARY KEY (step_uuid, depends_on_uuid)
);
CREATE INDEX idx_step_deps_workflow ON step_dependencies(workflow_id);
```

**step_logs: before**
```sql
CREATE TABLE step_logs (
    step_uuid   UUID PRIMARY KEY REFERENCES steps(id) ON DELETE CASCADE,
    log_text    TEXT NOT NULL
);
```

**step_logs: after**
```sql
CREATE TABLE step_logs (
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    step_uuid   UUID PRIMARY KEY,
    log_text    TEXT NOT NULL
);
CREATE INDEX idx_step_logs_workflow ON step_logs(workflow_id);
```

### 2. Batch inserts for upload performance

Replace individual `INSERT ... RETURNING id` loops with multi-row INSERT statements in batches of 1000. This reduces ~33,000 round-trips to ~33.

For steps, the challenge is that each step needs its generated UUID for the `tempId → uuid` map. Use `unnest()` array inserts with `RETURNING` to insert a full batch and get all UUIDs back in one round-trip:

```sql
INSERT INTO steps (workflow_id, step_id, parent_step_id, hierarchy_path, name, uri, pin, status, start_time, end_time, is_leaf, depth, sort_order)
SELECT * FROM unnest($1::uuid[], $2::text[], $3::uuid[], ...)
RETURNING id
```

For dependencies and logs (which don't need RETURNING), use plain multi-row VALUES:

```sql
INSERT INTO step_dependencies (workflow_id, step_uuid, depends_on_uuid)
VALUES ($1,$2,$3), ($4,$5,$6), ...
```

---

## Migration Plan

### Files to modify

1. **`workflow-server/src/lib/schema.ts`** — Update Drizzle schema:
   - Add `workflowId` column to `stepDependencies` with FK to `workflows.id` ON DELETE CASCADE
   - Remove `.references(() => steps.id, ...)` from both `stepUuid` and `dependsOnUuid` in `stepDependencies`
   - Add `workflowId` column to `stepLogs` with FK to `workflows.id` ON DELETE CASCADE
   - Remove `.references(() => steps.id, ...)` from `stepLogs.stepUuid`

2. **`workflow-server/src/lib/db.ts`** — Update insert and query logic:
   - `insertWorkflow`: batch step inserts using `unnest()`, include `workflowId` in dependency and log inserts, batch dependency and log inserts using multi-row VALUES
   - `getStepsAtLevel`: dependency query already joins via step_uuid (no change needed for reads)

3. **`workflow-server/design.md`** — Update schema documentation

4. **Generate Drizzle migration** — `bun run drizzle-kit generate` to create the migration SQL, then `bun run drizzle-kit migrate` to apply

### Database migration SQL

```sql
-- Add workflow_id to step_dependencies
ALTER TABLE step_dependencies ADD COLUMN workflow_id UUID;
UPDATE step_dependencies sd SET workflow_id = s.workflow_id FROM steps s WHERE sd.step_uuid = s.id;
ALTER TABLE step_dependencies ALTER COLUMN workflow_id SET NOT NULL;

-- Swap FKs on step_dependencies
ALTER TABLE step_dependencies DROP CONSTRAINT step_dependencies_step_uuid_fkey;
ALTER TABLE step_dependencies DROP CONSTRAINT step_dependencies_depends_on_uuid_fkey;
ALTER TABLE step_dependencies ADD CONSTRAINT step_dependencies_workflow_id_fkey
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE;
CREATE INDEX idx_step_deps_workflow ON step_dependencies(workflow_id);

-- Add workflow_id to step_logs
ALTER TABLE step_logs ADD COLUMN workflow_id UUID;
UPDATE step_logs sl SET workflow_id = s.workflow_id FROM steps s WHERE sl.step_uuid = s.id;
ALTER TABLE step_logs ALTER COLUMN workflow_id SET NOT NULL;

-- Swap FK on step_logs
ALTER TABLE step_logs DROP CONSTRAINT step_logs_step_uuid_fkey;
ALTER TABLE step_logs ADD CONSTRAINT step_logs_workflow_id_fkey
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE;
CREATE INDEX idx_step_logs_workflow ON step_logs(workflow_id);
```

Note: `steps.parent_step_id` already has no FK constraint, so no migration is needed for it.

### Verification

After implementation, re-run the large workflow upload/delete and confirm:

| Operation | Before | Expected After |
| --------- | ------ | -------------- |
| Upload    | ~5.5s  | < 1s           |
| Delete    | ~33s   | < 100ms        |

Run existing E2E tests (`bun run test:e2e-backend`) to verify no regressions.

---

## Tradeoffs

**What we lose:**
- No FK-enforced referential integrity between `step_dependencies` rows and `steps` rows. A bug in the upload pipeline could insert a dependency referencing a non-existent step UUID. This is acceptable because the upload pipeline already validates all `dependsOn` references before inserting.
- Same for `step_logs` — no FK guarantee that `step_uuid` exists in `steps`. Again, the upload pipeline controls all writes.

**What we gain:**
- ~620x faster deletes (~54ms vs ~33s)
- Simpler cascade model: deleting a workflow does 3 parallel bulk deletes instead of a recursive per-row cascade chain
- Foundation for batched inserts to improve upload speed
