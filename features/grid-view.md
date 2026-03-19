# Feature: Server-Side Pagination for Grid View

## Problem

`GraphContainer` auto-fetches **all** server pages via a `useEffect` loop before rendering anything. With 4000+ steps (4+ server pages of 1000), this means:

- The UI blocks with a loading spinner while all pages are fetched sequentially
- All steps are aggregated into a single array and passed to `GridFallback`
- `GridFallback` mounts all `StepCard` components into the DOM at once (client-side `PAGE_SIZE` is 10,000)

This is necessary for `GraphView` (dagre needs all nodes to compute layout) but unnecessary for `GridFallback`, which already paginates its display client-side. The test "all 4000 Checkout sub-steps are eventually rendered" expects all steps in the DOM simultaneously, which couples test correctness to the eager-fetch approach.

## Solution

Make `GridFallback` a server-paginated component: display one server page (1000 steps) at a time with Previous/Next controls, fetching each page on demand rather than upfront.

---

## Changes Required

### 1. `GraphContainer` (`ui/src/components/GraphContainer.tsx`)

**Current behavior:** Uses `useInfiniteQuery` with an auto-fetch `useEffect` that loads all pages before rendering. Passes the full aggregated `allSteps` array to `GridFallback`.

**New behavior:** Split into two fetching strategies based on whether the result will use grid or graph rendering.

- **Graph path (step count <= `GRID_THRESHOLD`):** Keep the existing `useInfiniteQuery` + auto-fetch approach unchanged. `GraphView` needs all nodes for dagre layout.
- **Grid path (step count > `GRID_THRESHOLD` or `viewMode === "grid"`):** Render `GridFallback` in server-paginated mode, passing pagination state instead of pre-fetched steps.

The challenge is that `GraphContainer` doesn't know the total step count until the first page loads. Approach:

1. Fetch the first page normally (the existing `useInfiniteQuery` initial fetch).
2. After the first page arrives, check `allSteps.length >= GRID_THRESHOLD` **or** `viewMode === "grid"`.
3. If grid mode: render `GridFallback` in server-paginated mode, passing it the pages fetched so far plus the pagination state from `useInfiniteQuery`.
4. If graph mode: continue auto-fetching remaining pages as today.

Concretely, remove the unconditional auto-fetch `useEffect` and replace it with a conditional one:

```typescript
// Only auto-fetch all pages when rendering as a graph (dagre needs all nodes)
const needsAllPages = !useGrid;

useEffect(() => {
  if (needsAllPages && hasNextPage && !isFetchingNextPage) {
    fetchNextPage();
  }
}, [needsAllPages, hasNextPage, isFetchingNextPage, fetchNextPage]);
```

Update the loading gate to only block on `hasNextPage` when in graph mode:

```typescript
if (isLoading) {
  return <div>Loading steps...</div>;
}

// In graph mode, wait for all pages before rendering
if (needsAllPages && hasNextPage) {
  return <div>Loading more steps...</div>;
}
```

Pass the pagination state to `GridFallback`:

```typescript
<GridFallback
  parentPath={parentPath}
  hasNextPage={!!hasNextPage}
  fetchNextPage={fetchNextPage}
  isFetchingNextPage={isFetchingNextPage}
  allPages={data?.pages ?? []}
/>
```

### 2. `GridFallback` (`ui/src/components/GridFallback.tsx`)

**Current behavior:** Receives a pre-fetched `steps: Step[]` array. Does client-side pagination with `PAGE_SIZE = 10_000`. Search and status filters operate on the full in-memory array.

**New behavior:** Manages server-page navigation. Each "page" in the UI corresponds to one server page (up to 1000 steps).

**Props change:**

```typescript
interface Props {
  // All pages fetched so far (from useInfiniteQuery)
  allPages: Array<{ steps: Step[]; dependencies: Dependency[]; nextCursor?: string }>;
  parentPath: string;
  // For fetching additional pages
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
}
```

**State:**

```typescript
const [pageIndex, setPageIndex] = useState(0);  // which server page to display
const [search, setSearch] = useState("");
```

**Rendering logic:**

- `pageIndex` selects which server page to display from `allPages[pageIndex]`.
- Previous/Next buttons change `pageIndex`.
- "Next" on the last loaded page calls `fetchNextPage()` to load one more server page, then advances `pageIndex` when it arrives.
- Search and status filters apply client-side to the **current page's** steps only.
- Display "Page X of Y+" where Y is the number of pages loaded so far, with a "+" indicator when `hasNextPage` is true (more pages exist on the server).

**Page navigation:**

```
[Previous] Page 2 of 4+ [Next]
```

- **Previous:** `setPageIndex(i => i - 1)`, disabled when `pageIndex === 0`.
- **Next:**
  - If `pageIndex < allPages.length - 1`: just increment `pageIndex` (page already fetched).
  - If `pageIndex === allPages.length - 1` and `hasNextPage`: call `fetchNextPage()`, show a loading indicator on the Next button, increment `pageIndex` when the new page arrives.
  - Disabled when on the last loaded page and `!hasNextPage`.

**Why not fetch all pages in GridFallback?** Fetching on demand means the first page renders immediately (no multi-second loading spinner), memory stays bounded, and the DOM never has more than 1000 `StepCard` nodes.

### 3. Test Update (`tests/e2e-tests-frontend.ts`)

**Current test [17]:** Expects "Checkout Step 1000" and "Checkout Step 3999" to be visible simultaneously, implying all 4000 steps are in the DOM at once.

**Updated test:** Navigate through server pages to verify all pages are accessible.

```typescript
test("4000 Checkout sub-steps are accessible via page navigation", async () => {
  // Upload and navigate into the Checkout step (4000 sub-steps)
  // ...

  // Page 1 loads automatically — verify a step from page 1 is visible
  await page.getByText("Checkout Step 0").first().waitFor({ timeout: 10_000 });

  // "Checkout Step 1000" is on page 2 — click Next
  const nextButton = page.getByRole("button", { name: /next/i });
  await nextButton.click();
  await page.getByText("Checkout Step 1000").first().waitFor({ timeout: 10_000 });

  // "Checkout Step 3999" is on page 4 — navigate forward
  await nextButton.click(); // page 3
  await page.getByText("Checkout Step 2000").first().waitFor({ timeout: 10_000 });
  await nextButton.click(); // page 4
  await page.getByText("Checkout Step 3999").first().waitFor({ timeout: 10_000 });

  // Verify Previous works
  const prevButton = page.getByRole("button", { name: /previous/i });
  await prevButton.click();
  await page.getByText("Checkout Step 2000").first().waitFor({ timeout: 10_000 });
});
```

### 4. Design Doc Updates

**`ui/design.md` — `GraphContainer` section:** Update to describe the dual fetching strategy:

> Rendering decision after the first page loads:
> - If total step count > `GRID_THRESHOLD` **or** `viewMode === 'grid'`: renders `GridFallback` in server-paginated mode (one server page at a time, on-demand fetching)
> - Otherwise: auto-fetches all remaining pages and renders `GraphView`

**`ui/design.md` — `GridFallback` section:** Update to describe server-side pagination:

> Receives pages from `GraphContainer`'s `useInfiniteQuery`. Displays one server page (up to 1000 steps) at a time with Previous/Next navigation. The Next button fetches the next server page on demand when the user advances past the last loaded page. Search and status filters apply client-side to the displayed page. Steps within each page are sorted by status priority (failed > running > passed > skipped > cancelled).

---

## What Does NOT Change

- **Server API:** No changes to `GET /api/workflows/:id/steps`. The existing cursor-based pagination with `limit=1000` is exactly what we need — each cursor page becomes one UI page.
- **`GraphView` / dagre rendering:** Still requires all nodes upfront. The auto-fetch-all behavior is preserved for graph mode.
- **`useInfiniteQuery`:** Still used as the fetching primitive. The only change is *when* additional pages are fetched (eagerly for graph, on-demand for grid).
- **`StepCard` / `StepNode` behavior:** No changes. Click behavior (navigate to sub-step or log viewer) remains the same.
- **Status filter / search:** Still applied client-side. The scope narrows from "all steps across all pages" to "steps on the current page", which is a minor behavioral change but acceptable since users paginate to find specific steps anyway.

---

## Sequence: Grid Mode with 4000 Steps

```
User clicks into step with 4000 children
  → GraphContainer mounts, useInfiniteQuery fetches page 1 (steps 0–999, nextCursor present)
  → First page arrives: 1000 steps > GRID_THRESHOLD → grid mode
  → GridFallback renders page 1 immediately (1000 StepCards)
  → User sees "Page 1 of 1+" with Previous (disabled) and Next

User clicks Next
  → GridFallback calls fetchNextPage()
  → Next button shows loading state
  → Page 2 arrives (steps 1000–1999)
  → GridFallback renders page 2, shows "Page 2 of 2+"

User clicks Next twice more
  → Pages 3 and 4 load on demand
  → Page 4 has no nextCursor → "Page 4 of 4" (no "+" indicator)
  → Next button disabled

User clicks Previous
  → pageIndex decrements, page 3 renders instantly (already cached in useInfiniteQuery)
```
