# Plan: Simplify Landing Page Search — Absorb ID Navigation into Command Palette

## Problem

The landing page has three overlapping ways to find/navigate to a workflow:

1. **Command Palette** — search by name/uri/pin, links to advanced search
2. **NavigateForm** — direct navigation by workflow ID or step UUID
3. **Standalone "Advanced Search" link** — goes to `/search`

This is redundant. The command palette already provides search and links to advanced search from its footer. The NavigateForm's ID-based navigation can be absorbed into the palette.

## Solution

Add a new `id:` prefix to the command palette's existing prefix system. When the user types `id:<uuid>`, the palette looks up the workflow or step by that UUID and displays the result in the palette's results list — the same way normal search results appear. This gives immediate feedback (found vs. not found) without navigating away, and keeps the UX consistent with the other prefix-based searches.

Then remove `NavigateForm` and the standalone advanced search link from the landing page.

---

## Changes

### 1. PRD (`PRD.md`)

#### CUJ 2: Landing Page Navigation — rewrite

Current text describes `NavigateForm` as a separate input on the landing page. Replace with:

> - The command palette (accessible from the landing page search trigger or Ctrl/Cmd+K) supports direct lookup by ID via the `id:` prefix: when the user types `id:<uuid>`, the palette looks up the workflow or step matching that UUID and displays it as a search result. The user can then click or press Enter to navigate to it.
> - If the UUID does not match any workflow or step, the palette shows a "not found" message in the results area — the user stays in the palette and can correct the ID without navigating to a dead-end page.

Remove all references to a separate "navigate by ID" form on the landing page. Remove the mention of a standalone "Advanced Search" link on the landing page (it's still accessible from the palette footer and from the search page itself).

#### CUJ 6: Navigation — minor update

The sentence "A quick-search / command palette ... is accessible from any view" is still accurate. No change needed.

#### CUJ 8: Field-Scoped Search via Command Palette — update

Add `id:` to the list of supported prefixes. Update the description to note that `id:` is a lookup prefix — when used, it looks up a workflow or step by UUID and displays the result inline. The `id:` prefix cannot be combined with other prefixes. Add `id:` to the help reference content.

#### CUJ 9: Advanced Search Page — minor update

The sentence "It is also accessible from the landing page" should be updated to: "It is also accessible from the command palette footer on the landing page." Remove any mention of a standalone link.

### 2. Frontend Design (`ui/design.md`)

#### Component Tree

Remove the `NavigateForm` entry and the `advanced-search link` entry under `UploadPage`:

```
├── UploadPage                       src/pages/UploadPage.tsx
│   ├── UploadForm                   src/components/UploadForm.tsx
│   └── CommandPalette               src/components/CommandPalette.tsx
```

#### `UploadPage` spec

Update the numbered list to:

1. A title and tagline
2. A search trigger button (🔍 Search or go to ID... ⌘K) that opens `CommandPalette` scoped to workflows only (no `workflowId`). Ctrl/Cmd+K also opens the palette.
3. `UploadForm` for uploading workflow JSON files

Remove items 4 (NavigateForm) and 5 (Advanced Search link).

#### `NavigateForm` spec — delete entirely

Remove the entire `NavigateForm` component specification section. The component will be deleted.

#### `CommandPalette` spec — add `id:` prefix behavior

Update the placeholder text:

> - When `workflowId` is absent (landing page): placeholder is `"Search or go to ID..."`
> - When `workflowId` is set (workflow/step view): placeholder is `"Search steps or go to ID..."`

Add `id:` as a lookup prefix to the Behavior list:

> - Supports an `id:` prefix for looking up a workflow or step by UUID. When `parseSearchQuery` encounters `id:<value>`, and `id:` is the only prefix present (no other prefixes or bare terms), the palette performs a UUID lookup instead of a text search. The lookup calls `lookupStep(uuid)` first; if that 404s, calls `getWorkflow(uuid)`. The resolved workflow or step is mapped to a `SearchResult` object and displayed in the standard results list — same rendering as normal search results (status badge, name, path/URI). If neither lookup finds a match, the results area shows a "No workflow or step found for this ID" message. If the value after `id:` is not a valid UUID format, the results area shows "Invalid UUID format".
> - The `id:` prefix cannot be combined with other prefixes or bare terms. If `id:` appears alongside other terms (e.g., `id:<uuid> name:build`), `id:` is treated as an invalid prefix (red pill) and the `id:value` text is folded into the bare `q` term for normal searching.
> - The `id:` prefix pill is styled distinctly (e.g., indigo/purple `#818cf8`) to visually signal that it performs a direct lookup rather than a text search.
> - The debounced search effect is skipped when `id:` is the active prefix. Instead, the lookup is triggered immediately (no debounce needed for a single UUID lookup).

#### Navigate-by-ID Flow — rewrite

Replace the current "Navigate-by-ID Flow" section under Interaction Flows with:

> ### Navigate-by-ID Flow
>
> The user types `id:<uuid>` into the command palette on the landing page (or any view). The palette recognizes the `id:` prefix and performs a direct lookup: it tries `lookupStep(uuid)` first, then falls back to `getWorkflow(uuid)`. The result is displayed as a standard search result in the palette. The user clicks or presses Enter to navigate to the workflow or step. If the UUID is not found, the palette shows a "not found" message inline — the user stays in the palette and can edit the ID. Non-UUID values after `id:` show an "Invalid UUID format" message.

#### Home Navigation Flow — no change needed

#### Advanced Search Flow — minor update

Remove the sentence "the link on `UploadPage`" from the list of ways to reach `/search`. It should read:

> The user navigates to `/search` via the "Advanced Search" link in the palette footer or directly.

### 3. Backend Design (`workflow-server/design.md`) — no changes

The `GET /api/steps/:uuid` endpoint, `GET /api/workflows/:id` endpoint, and `GET /api/search` endpoint are unchanged. The backend API surface is not affected by this change.

### 4. Source Code Changes

#### Delete `ui/src/components/NavigateForm.tsx`

Remove the file entirely.

#### Update `ui/src/pages/UploadPage.tsx`

- Remove the `NavigateForm` import and `<NavigateForm />` render.
- Remove the `Link` import (if no longer used) and the standalone "Advanced Search" `<Link>` element.
- Update the search trigger button text from `"🔍 Search workflows..."` to `"🔍 Search or go to ID..."`.

#### Update `ui/src/components/CommandPalette.tsx`

Add `id:` prefix support:

1. Add `"id"` to the `parseSearchQuery` function as a recognized prefix. Add it to the `ParsedQuery` interface:
   ```typescript
   interface ParsedQuery {
     q: string | null;
     name: string | null;
     uri: string | null;
     pin: string | null;
     path: string | null;
     id: string | null;           // NEW — lookup prefix
     invalidPrefixes: string[];
   }
   ```
   Add `"id"` to `VALID_PREFIXES` so it is parsed correctly (not treated as an invalid prefix).

2. Define a UUID regex constant:
   ```typescript
   const UUID_RE =
     /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
   ```

3. Derive an `isIdLookup` flag — true only when `id:` is the sole prefix (no other prefixes or bare terms):
   ```typescript
   const isIdLookup =
     parsed.id !== null &&
     parsed.q === null &&
     parsed.name === null &&
     parsed.uri === null &&
     parsed.pin === null &&
     parsed.path === null;
   ```

4. When `isIdLookup` is true:
   - Skip the debounced search in Effect 2 (add early return).
   - Add a new effect (Effect 3) that runs when `isIdLookup` and `parsed.id` change. This effect:
     - If `parsed.id` does not match `UUID_RE`: sets results to empty and sets an error state like `"Invalid UUID format"`.
     - If `parsed.id` matches `UUID_RE`: calls `lookupStep(uuid)` — on success, maps the response to a `StepSearchResult` and sets it as the sole result. On 404, calls `getWorkflow(uuid)` — on success, maps the response to a `WorkflowSearchResult` and sets it as the sole result. If both fail, sets results to empty and sets an error/message like `"No workflow or step found for this ID"`.
   - The mapping functions convert API responses to `SearchResult` objects:
     ```typescript
     // From lookupStep response → StepSearchResult
     function stepLookupToResult(resp: StepLookupResponse): StepSearchResult {
       return {
         type: "step",
         workflowId: resp.workflowId,
         workflowName: "", // not available from lookup, can be empty
         uuid: resp.step.uuid,
         name: resp.step.name,
         uri: resp.step.uri,
         pin: resp.step.pin,
         status: resp.step.status,
         hierarchyPath: resp.step.hierarchyPath,
         startTime: resp.step.startTime ?? null,
       };
     }

     // From getWorkflow response → WorkflowSearchResult
     function workflowToResult(w: WorkflowDetail): WorkflowSearchResult {
       return {
         type: "workflow",
         workflowId: w.id,
         name: w.name,
         uri: w.uri,
         pin: w.pin,
         status: w.status,
         startTime: w.startTime ?? null,
         uploadedAt: w.uploadedAt,
       };
     }
     ```
   - The result is rendered by the existing `PaletteResultsList` — no changes to result rendering.
   - The "not found" and "invalid UUID" messages are shown in the results area (same area where "No results" currently appears).

5. When `isIdLookup` is false, behavior is unchanged (existing prefix parsing + debounced search).

6. The `id:` prefix pill in `PalettePrefixIndicator` should be styled with a distinct color (e.g., indigo/purple `#818cf8`) to visually distinguish it from search filter pills.

7. Update the placeholder text:
   - When `workflowId` is absent: `"Search or go to ID..."`
   - When `workflowId` is set: `"Search steps or go to ID..."`

#### Update `ui/src/components/PaletteHelpPanel.tsx`

Add `id:` to the prefixes table in the help panel. It should appear as a visually separated entry (e.g., after a subtle divider or under a "Navigation" sub-heading) below the existing search prefixes:

| Prefix | Description | Example |
|--------|-------------|---------|
| `id:` | Go to workflow or step by UUID | `id:a1b2c3d4-...` |

Add a note: "The `id:` prefix looks up a workflow or step directly by its UUID. It cannot be combined with other prefixes."

#### Update `ui/src/components/PalettePrefixIndicator.tsx`

Support the distinct styling for the `id:` prefix pill. When the `field` is `"id"`, use the indigo/purple color (`#818cf8` background) instead of the standard blue.

#### Update `ui/src/components/WorkflowHeader.tsx`

Update the search trigger button text from `"🔍 Search steps..."` to `"🔍 Search steps or go to ID..."`. Update the corresponding `⌘K` hint styling if needed to accommodate the longer text.

#### Update `ui/src/pages/LogsPage.tsx`

If the logs page has its own search trigger text, update it similarly to `"Search steps or go to ID..."`.

#### Delete or update any imports of `NavigateForm`

Search the codebase for any other imports of `NavigateForm` and remove them. (Currently only imported in `UploadPage.tsx`.)

### 5. E2E Frontend Tests (`tests/e2e-tests-frontend.ts`)

#### Tests to remove or rewrite

There are no dedicated `NavigateForm` tests in the frontend E2E suite (the navigate-by-ID flow was not covered by a named test block). No test removals needed for that.

#### Test [29] Landing Page — Advanced Search Link — **remove entirely**

This test (`[29.1]`) asserts that the landing page has a visible "Advanced Search" link and clicking it navigates to `/search`. Since the standalone link is being removed from the landing page, this entire `describe("[29]")` block should be deleted.

#### Test [30.1] — no changes needed

Test `[30.1]` ("Mode 1: landing page palette → advanced search → workflow-only fields → search → workflow results") opens the palette and clicks `[data-testid="advanced-search-link"]` in the palette footer. This flow is **unchanged** — the palette footer's "Advanced Search" link still exists.

#### New test: `id:` prefix lookup in command palette — **add**

Add a new test block `[31] Command Palette — ID Prefix Lookup` with these cases:

1. **`[31.1]` `id:<step-uuid>` shows the step as a search result and navigates on Enter:**
   - Upload a workflow, obtain a step UUID by querying `GET /api/workflows/:id/steps`.
   - Go to landing page, open palette, type `id:<step-uuid>`.
   - Assert a `[data-testid="search-result"]` item appears (not the "no results" state).
   - Assert the result displays the step's name.
   - Press Enter, assert navigation to `/workflows/:workflowId/steps/:uuid`.

2. **`[31.2]` `id:<workflow-id>` shows the workflow as a search result and navigates on Enter:**
   - Use the workflow ID from the uploaded workflow.
   - Go to landing page, open palette, type `id:<workflow-id>`.
   - Assert a `[data-testid="search-result"]` item appears with the workflow name.
   - Press Enter, assert navigation to `/workflows/:workflowId`.

3. **`[31.3]` `id:` prefix works from the workflow-scoped palette too:**
   - From a workflow view, open palette, type `id:<step-uuid>`.
   - Assert the result appears and navigating works correctly.

4. **`[31.4]` `id:` with a non-existent UUID shows "not found":**
   - Open palette, type `id:00000000-0000-0000-0000-000000000000`.
   - Assert the results area shows a "not found" message (no `[data-testid="search-result"]` items).

5. **`[31.5]` `id:` with a non-UUID value shows "invalid UUID format":**
   - Open palette, type `id:not-a-uuid`.
   - Assert the results area shows an "invalid UUID" message.

6. **`[31.6]` Bare UUID input (without `id:` prefix) performs normal search, not ID lookup:**
   - Open palette, type a bare UUID string (no `id:` prefix).
   - Assert the palette performs a normal search (results or "no results"), NOT an ID lookup result.

7. **`[31.7]` `id:` prefix pill is shown with distinct styling:**
   - Open palette, type `id:<uuid>`.
   - Assert the prefix indicator bar (`[data-testid="prefix-indicator"]`) is visible and contains an `id` pill.

8. **`[31.8]` `id:` combined with other prefixes treats `id:` as invalid:**
   - Open palette, type `id:<uuid> name:build`.
   - Assert that `id` appears as a red invalid-prefix pill (`[data-testid="invalid-prefix"]`).
   - Assert that normal search is performed (not ID lookup).

### 6. E2E Backend Tests (`tests/e2e-tests-backend.ts`) — no changes

The backend API is unchanged. The existing `GET /api/steps/:uuid` test block covers the endpoint that the palette's ID lookup will use. No backend test modifications are needed.

---

## Summary of files changed

| File | Action |
|---|---|
| `PRD.md` | Update CUJ 2, CUJ 8, CUJ 9 |
| `ui/design.md` | Update component tree, UploadPage spec, CommandPalette spec, interaction flows; remove NavigateForm spec |
| `workflow-server/design.md` | No changes |
| `ui/src/components/NavigateForm.tsx` | **Delete** |
| `ui/src/pages/UploadPage.tsx` | Remove NavigateForm and Advanced Search link; update search trigger text |
| `ui/src/components/CommandPalette.tsx` | Add `id:` prefix to `parseSearchQuery`, lookup logic, UUID validation, placeholder text |
| `ui/src/components/WorkflowHeader.tsx` | Update search trigger text |
| `ui/src/pages/LogsPage.tsx` | Update search trigger text (if applicable) |
| `ui/src/components/PaletteHelpPanel.tsx` | Add `id:` prefix to help panel documentation |
| `ui/src/components/PalettePrefixIndicator.tsx` | Distinct styling for `id:` prefix pill |
| `tests/e2e-tests-frontend.ts` | Remove test [29]; add test [31] for `id:` prefix lookup |
| `tests/e2e-tests-backend.ts` | No changes |
