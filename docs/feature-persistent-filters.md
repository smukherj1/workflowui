# Feature: Client-Side Filtering with Full Data Load

## Problem

When a hierarchy level has many sub-steps (e.g., 4000 across 4 server pages), status filtering is applied **client-side per page** after server-paginated data arrives. This causes several UX problems:

1. **Blank pages**: If only 3 of 4000 steps are `failed` and scattered across server pages, filtering to `failed` shows mostly empty pages — the user must click through blank pages to find the few matching steps.
2. **Inaccurate page count**: The UI shows `Page X of Y+` because the server uses cursor-based pagination without a total count. The `+` suffix is confusing.
3. **Unnecessary filtering in DAG view**: The graph view (dagre) renders ≤50 steps where status is visible at a glance via colored badges. Filtering adds complexity without value.

## Solution

Simplify by removing server-side pagination for steps entirely. The PRD now caps steps per hierarchy level at **10,000** (down from 1M). The server returns **all steps at a given level in a single response** — no cursors, no `limit` parameter. The UI loads all steps upfront, then handles pagination and status filtering entirely client-side. This makes filtering instant (no refetch), gives the client full visibility into total pages, and simplifies the server.

---

## Changes

### 1. Server: `GET /api/workflows/:id/steps` — Remove Pagination

**File: `workflow-server/src/routes/steps.ts`**

Remove `cursor` and `limit` from the Zod query schema:

```typescript
// Before:
const querySchema = z.object({
  parentId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(1000),
});

// After:
const querySchema = z.object({
  parentId: z.string().uuid().optional(),
});
```

Update the handler to call the simplified db function:

```typescript
const result = await getStepsAtLevel(id, parentId ?? null);
```

**File: `workflow-server/src/lib/db.ts`** — `getStepsAtLevel`

Remove `cursor` and `limit` parameters. Remove cursor decoding, `limit + 1` fetch trick, and `nextCursor` computation. Fetch all steps at the level in one query:

```typescript
export async function getStepsAtLevel(
  workflowId: string,
  parentId: string | null,
) {
  // Build conditions: workflowId match + parentId match (or IS NULL)
  // Single query: SELECT all matching steps ORDER BY sortOrder ASC
  // Fetch child counts for non-leaf steps
  // Fetch ALL dependencies at this level (no page-scoping needed)
  return { steps, dependencies };
}
```

The response no longer includes `nextCursor`.

### 2. Server: Response Shape Update

**Before:**
```json
{
  "steps": [...],
  "dependencies": [{ "from": "...", "to": "..." }],
  "nextCursor": "base64url(...)"
}
```

**After:**
```json
{
  "steps": [...],
  "dependencies": [{ "from": "...", "to": "..." }]
}
```

`nextCursor` is removed. All steps and all dependencies at the level are returned in one response.

### 3. Server: Validation Limit — 1M → 10,000

**File: `workflow-server/src/lib/validation.ts`**

```typescript
// Before:
const MAX_STEPS_PER_LEVEL = 1_000_000;

// After:
const MAX_STEPS_PER_LEVEL = 10_000;
```

### 4. Frontend Types

**File: `ui/src/lib/types.ts`**

Remove `nextCursor` from `StepsResponse`:

```typescript
// Before:
export interface StepsResponse {
  steps: Step[];
  dependencies: Dependency[];
  nextCursor: string | null;
}

// After:
export interface StepsResponse {
  steps: Step[];
  dependencies: Dependency[];
}
```

### 5. Frontend API Client

**File: `ui/src/lib/api.ts`** — `getSteps`

Remove `cursor` parameter:

```typescript
// Before:
export async function getSteps(
  workflowId: string,
  parentId?: string,
  cursor?: string,
): Promise<StepsResponse> {
  const params = new URLSearchParams();
  if (parentId) params.set("parentId", parentId);
  if (cursor) params.set("cursor", cursor);
  // ...
}

// After:
export async function getSteps(
  workflowId: string,
  parentId?: string,
): Promise<StepsResponse> {
  const params = new URLSearchParams();
  if (parentId) params.set("parentId", parentId);
  // ...
}
```

### 6. Frontend: `GraphContainer` — Single Fetch, Client-Side Everything

**File: `ui/src/components/GraphContainer.tsx`**

Replace `useInfiniteQuery` with `useQuery` — there's only one request now that returns all steps:

```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ["steps", workflowId, parentId],
  queryFn: () => getSteps(workflowId, parentId),
});
```

Remove all `useInfiniteQuery` logic: `fetchNextPage`, `hasNextPage`, `getNextPageParam`, the auto-fetch-all-pages effect, and the page flattening code.

**Client-side filtering**: Read `statusFilter` from the store. Filter `data.steps` in a `useMemo`:

```typescript
const { statusFilter } = useWorkflowStore();

const filteredSteps = useMemo(() => {
  if (!data) return [];
  if (statusFilter.length === 0) return data.steps;
  return data.steps.filter((s) => statusFilter.includes(s.status));
}, [data, statusFilter]);
```

**Rendering decision** (unchanged threshold logic):
- If `data.steps.length > GRID_THRESHOLD` or `viewMode === "grid"`: render `GridFallback` with `filteredSteps`
- Otherwise: render `GraphView` with `filteredSteps` and filtered edges

**Remove the "View Logs" link from `GraphContainer`** — no change here, just noting it stays.

Pass `filteredSteps` and `allDependencies` to child components. `GridFallback` receives the full filtered array and paginates client-side. `GraphView` receives the full filtered array for dagre layout.

### 7. Frontend: `GridFallback` — Pure Client-Side Pagination

**File: `ui/src/components/GridFallback.tsx`**

`GridFallback` now receives a flat `steps: Step[]` array (already filtered by status from `GraphContainer`) instead of paginated server pages.

Client-side pagination with a page size of 1000:

```typescript
const PAGE_SIZE = 1000;

function GridFallback({ steps, ... }) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(steps.length / PAGE_SIZE));
  const pageSteps = steps.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset to page 1 when steps array changes (e.g., filter toggled)
  useEffect(() => {
    setCurrentPage(1);
  }, [steps.length]);

  // ...
  <span>Page {currentPage} of {totalPages}</span>
}
```

Remove:
- Server page references (`pages` prop, `useInfiniteQuery` page model)
- The `Y+` page indicator logic
- Client-side status filtering (already done upstream in `GraphContainer`)
- Status-priority sorting (failed steps are now easily found via filtering)

Keep:
- Local text search filter (name substring match)
- Prev/Next pagination controls (now over client-side pages)

### 8. Frontend: `StatusFilterBar` — Hide in DAG Mode

**File: `ui/src/components/WorkflowLayout.tsx`**

Only render `StatusFilterBar` when the current level is in grid mode. Since `WorkflowLayout` doesn't know the step count directly, `GraphContainer` sets an `isGridMode` flag in the store:

```typescript
// In WorkflowLayout.tsx:
const { isGridMode } = useWorkflowStore();
// ...
{isGridMode && <StatusFilterBar />}
```

When viewing a DAG (≤50 steps), the filter bar is hidden — status is already visible via colored badges on each node.

### 9. Zustand Store

**File: `ui/src/store/workflowStore.ts`**

Add `isGridMode`:

```typescript
interface WorkflowState {
  statusFilter: StepStatus[];
  setStatusFilter: (statuses: StepStatus[]) => void;
  viewMode: "dagre" | "grid";
  setViewMode: (mode: "dagre" | "grid") => void;
  isGridMode: boolean;
  setIsGridMode: (val: boolean) => void;
  // ... existing breadcrumb state
}
```

`GraphContainer` calls `setIsGridMode(true)` when rendering grid, `setIsGridMode(false)` when rendering DAG. `WorkflowLayout` reads it to show/hide the filter bar.

### 10. Frontend: `GraphView` — Minor Cleanup

**File: `ui/src/components/GraphView.tsx`**

No major changes. `GraphView` receives the full step array (potentially filtered) and all dependencies. Edges between steps not present in the filtered set are naturally excluded since dagre only lays out the nodes it's given. Remove any explicit status-filter-based edge filtering if present.

---

## Design Doc Updates

### `design.md` (root)

Update the context line:

```
// Before:
The design must handle up to 1M steps per hierarchy level...

// After:
The design must handle up to 10,000 steps per hierarchy level...
```

### `workflow-server/design.md`

**Structural limits** (line 217): Change `max 1M steps/level` to `max 10,000 steps/level`.

**Steps endpoint**: Remove `cursor` and `limit` from the endpoint signature and documentation:

```
// Before:
GET /api/workflows/:id/steps?parentId=&cursor=&limit=

// After:
GET /api/workflows/:id/steps?parentId=
```

**Steps response shape**: Remove `nextCursor`:

```json
{
  "steps": [...],
  "dependencies": [...]
}
```

**Cursor documentation** (line 207): Remove the sentence about cursor for steps being `base64url(sort_order)`. The cursor for logs is unchanged.

**`getStepsAtLevel` description**: Remove references to cursor decoding, limit+1 fetch, and hasMore detection.

### `ui/design.md`

**`GraphContainer`** section:
- Remove all references to `useInfiniteQuery`, cursor-based pagination, and auto-fetching remaining pages.
- Document that it uses `useQuery` to fetch all steps in one call.
- Document that status filtering is applied client-side via `useMemo`, only active in grid mode.
- Document that `GraphContainer` sets `isGridMode` in the store.

**`GridFallback`** section:
- Remove references to server-paginated mode and on-demand fetching.
- Document that it receives a flat filtered array and paginates client-side with `PAGE_SIZE = 1000`.
- Remove the `Y+` page indicator description — replace with `Page X of Y`.
- Remove status-priority sorting description.
- Remove client-side status filtering description (handled upstream).

**`StatusFilterBar`** section: Note that the filter bar is only shown when in grid mode.

**`GraphView`** section: Note that edges are filtered to only connect nodes present in the (possibly filtered) step array passed by `GraphContainer`.

**Zustand store** section: Add `isGridMode` to the store shape documentation.

**Large Step Count Strategy** section: Update threshold from 10,000 to the current `GRID_THRESHOLD` (50). Clarify that the 10,000 cap is enforced at upload validation, and the grid/DAG switch at 50 steps is a rendering performance threshold.

---

## All Files Requiring Changes

### Code Changes

| File | Change |
|------|--------|
| `workflow-server/src/lib/validation.ts` | `MAX_STEPS_PER_LEVEL`: 1,000,000 → 10,000 |
| `workflow-server/src/lib/db.ts` | Remove `cursor`/`limit` params from `getStepsAtLevel`, remove cursor logic, fetch all steps |
| `workflow-server/src/routes/steps.ts` | Remove `cursor`/`limit` from query schema, simplify handler call |
| `ui/src/lib/types.ts` | Remove `nextCursor` from `StepsResponse` |
| `ui/src/lib/api.ts` | Remove `cursor` param from `getSteps` |
| `ui/src/store/workflowStore.ts` | Add `isGridMode` / `setIsGridMode` |
| `ui/src/components/GraphContainer.tsx` | Replace `useInfiniteQuery` with `useQuery`, client-side filter + pagination, set `isGridMode` |
| `ui/src/components/GridFallback.tsx` | Accept flat `steps[]`, client-side pagination with `PAGE_SIZE`, exact page count |
| `ui/src/components/WorkflowLayout.tsx` | Conditionally render `StatusFilterBar` based on `isGridMode` |
| `ui/src/components/GraphView.tsx` | Minor: remove any explicit status-filter edge logic if present |

### Documentation Changes

| File | Change |
|------|--------|
| `design.md` | "1M steps" → "10,000 steps" |
| `workflow-server/design.md` | Remove cursor/limit from steps endpoint, response shape, structural limits |
| `ui/design.md` | Update GraphContainer, GridFallback, StatusFilterBar, store, large step count sections |

### Test Changes

| File | Change |
|------|--------|
| `tests/e2e-tests-backend.ts` | Remove/update tests for cursor-based step pagination if any exist |
| `tests/e2e-tests-frontend.ts` | Update tests for grid pagination (no more `Y+`), status filtering behavior |

---

## Implementation Order

1. **Server: validation** — Change `MAX_STEPS_PER_LEVEL` to 10,000
2. **Server: db** — Simplify `getStepsAtLevel` (remove cursor/limit)
3. **Server: route** — Remove `cursor`/`limit` from query schema
4. **Frontend: types** — Remove `nextCursor` from `StepsResponse`
5. **Frontend: api** — Remove `cursor` from `getSteps`
6. **Frontend: store** — Add `isGridMode`
7. **Frontend: GraphContainer** — `useQuery` instead of `useInfiniteQuery`, client-side filter, set `isGridMode`
8. **Frontend: GridFallback** — Flat steps array, client-side pagination, exact page count
9. **Frontend: WorkflowLayout** — Conditionally render `StatusFilterBar`
10. **Design docs** — Update all three design docs
11. **Tests** — Update E2E tests

---

## Testing

- Upload a workflow with 4000 steps where only 3 are `failed`
- Filter to `failed` → all 3 failed steps appear on page 1, page indicator shows `Page 1 of 1`
- Clear filter → all 4000 steps shown, `Page 1 of 4`
- Filter to `failed` + `running` → union of matching steps, correct page count
- DAG mode (≤50 steps) → no filter bar visible, all steps rendered
- Grid mode (>50 steps) → filter bar visible, filtering is instant (no network request)
- Verify upload rejects workflows with >10,000 steps at any level
- Verify no `nextCursor` in steps API responses
