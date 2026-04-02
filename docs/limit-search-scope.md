# Limit Search Scope: Workflows-Only for Unscoped Search

## Motivation

The `steps` table is indexed on `workflow_id`, so step searches scoped to a specific workflow use the index efficiently. However, unscoped step searches (no `workflowId`) require full table scans on `steps`, which degrades performance at scale. This change restricts the search API and UI so that unscoped searches only return workflows, while workflow-scoped searches (within a specific workflow view) continue to search steps.

---

## API Changes (`workflow-server/src/routes/search.ts`)

### Remove `scope` parameter

The `scope` query parameter (`"workflows"`, `"steps"`, `"all"`) is removed entirely. The API determines what to search based on whether `workflowId` is provided:

- **Without `workflowId`**: search workflows only. The `path` parameter is rejected (return 400) since it only applies to steps.
- **With `workflowId`**: search steps within that workflow only. No workflow results are returned.

### Updated Zod schema

```typescript
const querySchema = z
  .object({
    q: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    uri: z.string().min(1).optional(),
    pin: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    workflowId: z.uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict()
  .refine((d) => d.q || d.name || d.uri || d.pin || d.path, {
    message: "At least one search term (q, name, uri, pin, or path) is required",
  })
  .refine((d) => !(d.path && !d.workflowId), {
    message: "path filter requires workflowId",
  });
```

### Updated handler logic

```typescript
router.get("/", zValidator("query", querySchema), async (c) => {
  const { q, name, uri, pin, path, workflowId, from, to, limit } =
    c.req.valid("query");

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (workflowId) {
    // Step search scoped to a workflow
    const results = await searchSteps(
      { q, name, uri, pin, path },
      workflowId,
      fromDate,
      toDate,
      limit,
    );
    return c.json({ results });
  }

  // Workflow-only search
  const results = await searchWorkflows(
    { q, name, uri, pin },
    fromDate,
    toDate,
    limit,
  );
  return c.json({ results });
});
```

---

## Frontend Changes

### `CommandPalette` (`src/components/CommandPalette.tsx`)

- **Without `workflowId` prop** (landing page, no workflow context): search calls pass no `workflowId`, which now returns workflows only. No scope toggle needed. Results show workflow entries only.
- **With `workflowId` prop** (within a workflow view): search calls pass `workflowId`, which returns steps within that workflow. Behavior unchanged.

Remove any `scope` parameter from search API calls. The presence/absence of `workflowId` is the sole determinant.

### `SearchPage` / `SearchForm` (`src/pages/SearchPage.tsx`, `src/components/SearchForm.tsx`)

The advanced search page operates in two modes based on whether `workflowId` is present in the URL:

**Without `workflowId`** (reached from landing page or landing page palette):
- Searches workflows only.
- **Remove the Scope dropdown** and `scope` URL parameter.
- **Hide the `path` input** — path search only applies to steps.
- **Hide the Workflow ID input** — this mode is for cross-workflow search.
- Results are workflow-type only.
- URL parameters: `q`, `name`, `uri`, `pin`, `from`, `to`.

**With `workflowId`** (reached from workflow/step view palette "Advanced Search →"):
- Searches steps within that workflow.
- **Remove the Scope dropdown** and `scope` URL parameter.
- **Show the `path` input** — path search is useful for steps.
- **Show the Workflow ID as read-only** — the value is fixed to the workflow the user navigated from. Displayed for context but not editable.
- Results are step-type only.
- URL parameters: `q`, `name`, `uri`, `pin`, `path`, `workflowId`, `from`, `to`.

- **Remove `from`/`to` date inputs** if they filter on `startTime` from the upload JSON — workflows always have `uploadedAt` which can be used instead. Keep them if they already filter on `uploadedAt`. *(Check implementation; if they filter `startTime`, keep them as-is since `startTime` is indexed on workflows.)*

### `SearchResultsTable` (`src/components/SearchResultsTable.tsx`)

- **Without `workflowId`**: remove step-type row rendering, all rows navigate to `/workflows/:workflowId`, remove the "Type" column.
- **With `workflowId`**: keep step-type row rendering (hierarchy path, step UUID navigation), rows navigate to `/workflows/:workflowId/steps/:uuid`, remove the "Type" column (all results are steps).

### `src/lib/api.ts`

- `search()` function: remove the `scope` parameter. When `workflowId` is provided, pass it (along with `path` if set); otherwise omit both `workflowId` and `path`.

### `src/lib/types.ts`

- Remove `StepSearchResult` from the search result union if it's no longer possible without a `workflowId` context. Keep it for `CommandPalette` use (which passes `workflowId`).

### `UploadPage` (`src/pages/UploadPage.tsx`)

- The landing page `CommandPalette` (no `workflowId`) now only returns workflow results. Update the search trigger button text from "Search workflows..." to match (already correct).

---

## Design Doc Updates

### `workflow-server/design.md`

**Search API route table row**: update to remove `scope` parameter:

```
GET /api/search?q=&name=&uri=&pin=&path=&workflowId=&from=&to=&limit=
```

**Search parameter table**: remove the `scope` row. Update `path` description to note it requires `workflowId`. Update `workflowId` description: "When provided, searches steps within this workflow. When omitted, searches workflows only."

### `ui/design.md`

**`CommandPalette` spec**: update to remove scope toggle description. Without `workflowId`, default search returns workflows only. With `workflowId`, returns steps within that workflow.

**`SearchPage` spec**: remove Scope select from the controls table. Note that the page operates in two modes: without `workflowId` (workflows only, path and workflowId inputs hidden) and with `workflowId` (steps within that workflow, path input shown, workflowId shown as read-only).

**`SearchForm` spec**: remove Scope row. Path and Workflow ID rows remain but are conditionally shown based on whether `workflowId` is present. Workflow ID is read-only when shown.

**`SearchResultsTable` spec**: without `workflowId`, results are workflows only. With `workflowId`, results are steps only. Remove the "Type" column in both modes (type is determined by context).

**`src/lib/api.ts` section**: update `search()` description to remove `scope` parameter.

**Advanced Search Flow**: update to reflect dual-mode behavior — workflows-only without `workflowId`, steps-only with `workflowId`.

**Search Flow**: update `CommandPalette` description — without `workflowId` scope is workflows; with `workflowId` scope is steps within that workflow.

### `design.md` (root)

No changes needed (search details are delegated to sub-designs).

---

## Test Changes

### Backend (`tests/e2e-tests-backend.ts`)

**Tests to remove:**

- `"search by name finds steps (scope=steps)"` (line 726) — unscoped step search no longer exists
- `"scope=all returns both workflow and step results"` (line 744) — `scope` parameter removed
- `"path param finds steps by hierarchy path"` (line 795) — `path` without `workflowId` is now rejected
- `"path param ignored for scope=workflows"` (line 807) — `scope` parameter removed
- `"results include required fields for step type"` (line 853) — tests unscoped step results
- `"search is case-insensitive"` (line 868) — uses `scope=steps` without `workflowId`; needs rewrite or removal
- `"limit caps number of results returned"` (line 830) — uses `scope=steps` without `workflowId`; needs rewrite

**Tests to update:**

- `"missing all search terms returns 400"` (line 650) — remove `scope=all` from query string
- `"old field param is rejected (400)"` (line 660) — remove if it references `scope`; keep if it just tests `field` rejection
- `"name + pin filters are ANDed"` (line 665) — remove `scope=workflows` (still works, workflows-only is default)
- `"name + pin AND filters exclude non-matching"` (line 676) — remove `scope=workflows`
- `"q + pin filters are ANDed"` (line 686) — remove `scope=workflows`
- `"q + pin AND excludes non-matching"` (line 697) — remove `scope=workflows`
- `"search by name finds workflows (scope=workflows)"` (line 707) — remove `scope=workflows`, rename to "search by name finds workflows"
- `"name param searches name only"` (line 755) — remove `scope=workflows`
- `"uri param finds workflows by URI"` (line 769) — remove `scope=workflows`
- `"pin param finds workflows by pin"` (line 782) — remove `scope=workflows`
- `"results include required fields for workflow type"` (line 840) — remove `scope=workflows`
- `"no results for unmatched query"` (line 878) — remove `scope=all`

**Tests to add:**

- `"scope parameter is rejected (400)"` — `GET /api/search?q=hello&scope=all` returns 400 (strict schema rejects unknown param)
- `"path without workflowId returns 400"` — `GET /api/search?path=%2Fci` returns 400
- `"workflowId scopes search to steps"` — keep existing test (line 817) but remove `scope=steps`; verify results are step type
- `"search without workflowId returns only workflow results"` — `GET /api/search?q=nested` returns only `type: "workflow"` results
- `"path with workflowId finds steps"` — `GET /api/search?path=%2Fci%2F&workflowId=<id>` returns step results
- `"case-insensitive search (workflows)"` — rewrite of line 868 using workflow names instead of step names
- `"limit caps results (workflows)"` — rewrite of line 830 without `scope`

### Frontend (`tests/e2e-tests-frontend.ts`)

**Tests to update:**

- `[21] "typing in command palette shows step results for current workflow"` (line 1212) — no change needed; this is within a workflow view so step results are expected
- `[23] "landing page palette searches all workflows"` (line 1601) — update description/assertion: results should contain only workflow-type entries, not steps
- `[24] Prefix Search tests` — tests that use `path:` prefix from the landing page palette need updating. The `path:` prefix should only work when `workflowId` is set (within a workflow view). From the landing page, `path:` should be treated as a bare search term or show no results. Update:
  - `[24.3] path prefix` (line ~1810) — if this is from a workflow-scoped palette, keep as-is. If from landing page, update to expect no step results or move to a workflow-scoped test.
- `[26.4] "Advanced Search" from workflow-scoped palette includes workflowId` (line 2657) — keep; the advanced search page uses `workflowId` to enter workflow-scoped step search mode

**Tests to update in Advanced Search sections:**

- `[27.1] per-field inputs` (line 2703) — remove assertion for scope `select` count (`expect(await page.locator("select").count()).toBe(1)` becomes 0 or is removed). Keep `search-input-path` assertion but move it to a workflow-scoped test (path input only shown when `workflowId` is present). Remove date input count assertion if date inputs are removed.
- `[27.5] Clear button` (line 2832) — remove `select` assertions. Keep `path` assertion only in workflow-scoped context.
- `[28.3] URL pre-fill with scope=steps` (line 2998) — rewrite: remove `scope` param, but keep the test for URL pre-fill with `workflowId` — when `workflowId` is in the URL, the page should show step search mode with path input visible and workflowId displayed as read-only
- `[28.5] clicking a step result navigates to step view` (line 3048) — keep this test but scope it to workflow-scoped advanced search (with `workflowId` in URL)

**Tests to add:**

- Advanced search without `workflowId` returns workflow-type results only — verify no step-type badges and no path input
- Advanced search with `workflowId` returns step-type results only — verify path input is shown, workflowId is read-only
- Advanced search with `workflowId` shows workflow name/context for orientation
