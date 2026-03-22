# Design: Search & Navigation Improvements

## Problem

The current navigation has several limitations:

1. **No search**: Users can only find workflows or steps by exact ID. There's no way to search by name, URI, pin, hierarchy path, or date — the fields users actually remember.

2. **Logs viewer navigation is limited**: `LogsPage` only links back to the workflow root (`/workflows/:workflowId`) and the landing page. It doesn't let the user navigate to the specific step they came from or to any point along the hierarchy path (unlike the breadcrumbs in `WorkflowLayout`).

3. **No in-workflow step search**: When viewing a workflow, there's no way to find a specific step without manually navigating the hierarchy. Large workflows with deep nesting make this painful.

4. **Navigation elements are minimal**: The only persistent navigation element is the "WorkflowUI" home link in `WorkflowHeader`. There's no unified way to access search, navigate the hierarchy, or jump between views.

---

## Proposed Changes

### 1. Search API

A new endpoint for searching workflows and steps.

#### `GET /api/search?q=&scope=&workflowId=&field=&from=&to=&limit=`

| Parameter    | Required | Description |
| ------------ | -------- | ----------- |
| `q`          | Yes      | Search term (substring match, case-insensitive) |
| `scope`      | No       | `"workflows"`, `"steps"`, or `"all"` (default `"all"`) |
| `workflowId` | No       | Scope step search to a specific workflow |
| `field`      | No       | Restrict search to specific field: `"name"`, `"uri"`, `"pin"`, `"path"`. Default: searches name, URI, and pin together |
| `from`       | No       | Filter by start time >= this RFC 3339 timestamp |
| `to`         | No       | Filter by start time <= this RFC 3339 timestamp |
| `limit`      | No       | Max results (default 20, max 100) |

**Response shape:**

```json
{
  "results": [
    {
      "type": "workflow",
      "workflowId": "...",
      "name": "my-pipeline",
      "uri": "github://org/repo",
      "pin": "abc123",
      "status": "passed",
      "startTime": "...",
      "uploadedAt": "..."
    },
    {
      "type": "step",
      "workflowId": "...",
      "workflowName": "my-pipeline",
      "uuid": "...",
      "name": "build-frontend",
      "uri": "...",
      "pin": "...",
      "status": "failed",
      "hierarchyPath": "/ci/build-frontend",
      "startTime": "..."
    }
  ]
}
```

**Database considerations:**
- Workflow search queries the `workflows` table: `WHERE name ILIKE '%q%' OR uri ILIKE '%q%' OR pin ILIKE '%q%'`
- Step search queries the `steps` table with the same pattern, plus optional `workflow_id` filter and `hierarchy_path ILIKE` for path search
- Date filtering uses the `start_time` column on both tables
- No special indexes needed — `ILIKE` is sufficient given the modest data volume (7-day retention). GIN indexes for full-text search can be added later via the Drizzle schema if performance requires it.

### 2. Fix LogsPage Navigation — Add Breadcrumbs

`LogsPage` currently shows a flat header with only "WorkflowUI" (home link), the workflow name, the step path, and "← Back to workflow". This should be replaced with full breadcrumb navigation matching what `WorkflowLayout` provides.

**Change:** `LogsPage` will resolve its `stepPath` into breadcrumb links. The step path (e.g., `/step-1/step-1a/step-1a-i`) already encodes the hierarchy. The logs API response already includes `stepId` and `stepPath` per line. To build breadcrumbs, `LogsPage` will call the existing `GET /api/workflows/:id/steps/:uuid` endpoint for the deepest step to get its breadcrumbs array, or we add breadcrumb data to the logs response.

**Preferred approach — resolve breadcrumbs from stepPath:**

Add a new lightweight endpoint or extend the existing logs endpoint:

`GET /api/workflows/:id/breadcrumbs?stepPath=`

Returns:
```json
{
  "breadcrumbs": [
    { "uuid": "...", "name": "CI", "hierarchyPath": "/ci" },
    { "uuid": "...", "name": "build-frontend", "hierarchyPath": "/ci/build-frontend" }
  ]
}
```

`LogsPage` header will then render:
```
WorkflowUI > workflow-name > CI > build-frontend > [Logs]
```
Where each segment is a clickable link: "WorkflowUI" → `/`, workflow name → `/workflows/:id`, each step → `/workflows/:id/steps/:uuid`, and "Logs" is plain text (current view).

### 3. Command Palette with Search-Bar Trigger

A command palette overlay for searching workflows and steps, triggered by keyboard shortcut (Cmd/Ctrl+K) or by clicking a search-bar-shaped element in the header.

#### Trigger: Search Bar in Header

The `WorkflowHeader` (and `LogsPage` header) includes a search-bar-shaped clickable element that doubles as a discoverability hint. It looks like a muted input field with placeholder text and the keyboard shortcut displayed inline:

```
┌─────────────────────────────────────────────────────────────────┐
│ WorkflowUI  ● pipeline-name   [🔍 Search steps...  ⌘K]  2h ago│
├─────────────────────────────────────────────────────────────────┤
│ pipeline-name > CI > build-frontend                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                      (graph / content)                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The element is styled as a subdued, rounded input (border, muted placeholder text, slightly recessed background) so it's immediately recognizable as "there's search here." It is not an actual input — clicking it opens the command palette overlay. The `⌘K` badge inside passively teaches the keyboard shortcut.

On the landing page (`UploadPage`), the same trigger appears in a lightweight top bar or inline with the existing content, with placeholder text "Search workflows... ⌘K".

#### Palette Overlay

When activated, a centered floating modal appears with a real text input auto-focused:

```
┌───────────────────────────────────────┐
│ 🔍 Search steps...                    │
├───────────────────────────────────────┤
│ ● build-frontend    /ci/build-fe...   │
│ ✗ test-unit         /ci/test-unit     │
│ ● deploy-staging    /deploy/stag...   │
│ ...                                   │
└───────────────────────────────────────┘
```

Results appear below as the user types (debounced API calls). Each result row shows: status badge, name, hierarchy path (truncated), and the matched field highlighted. Arrow keys navigate the result list; Enter or click navigates to the selected result. Escape or clicking outside closes the palette.

#### Context-Aware Behavior

- **Within a workflow** (WorkflowView, StepView, or LogsPage): searches steps in the current workflow by default. The placeholder reads "Search steps...". A toggle or prefix (e.g., typing `@` first) switches to searching all workflows.
- **On the landing page**: searches all workflows. The placeholder reads "Search workflows...".

#### Landing Page

The landing page keeps its existing `UploadForm` and `NavigateForm` unchanged. The command palette is the search mechanism — no additional search form needed, keeping the landing page clean. `NavigateForm` remains for exact-ID lookup.
