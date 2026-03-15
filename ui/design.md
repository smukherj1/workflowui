# Technical Design: Frontend (Vite + React SPA)

## Overview

The frontend is a single-page application that lets users upload workflow JSON files and visualize the resulting step hierarchy as an interactive DAG. It communicates exclusively with the Express API server (`ui/server`) described in [`ui/server/design.md`](server/design.md). The root [`design.md`](../design.md) covers system architecture, upload schema, and technology choices.

---

## Tech Stack

| Library                      | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| Vite + React 18 (TypeScript) | SPA build & runtime                                          |
| React Router v7              | Client-side routing with nested layout routes                |
| React Flow v11               | DAG canvas with pan/zoom, custom nodes, and edge styling     |
| dagre                        | Automatic DAG layout (topological top-to-bottom)             |
| Zustand                      | Lightweight global UI state                                  |
| TanStack Query v5            | Data fetching, caching, cursor-based infinite pagination     |

Styling uses inline styles throughout. No CSS framework is used.

---

## Route Structure

```
/                                    → UploadPage
/workflows/:workflowId               → WorkflowView (top-level DAG)
/workflows/:workflowId/steps/:uuid   → StepView (sub-step DAG or leaf detail)
```

The `/workflows/:workflowId` and `/workflows/:workflowId/steps/:uuid` routes are nested under `WorkflowLayout` as a React Router parent route. `WorkflowLayout` fetches workflow metadata once and renders a shared chrome (header, breadcrumb, status filter, log panel) around the route outlet.

---

## Component Tree

```
App                                  src/App.tsx
├── UploadPage                       src/pages/UploadPage.tsx
│   └── UploadForm                   src/components/UploadForm.tsx
│
└── WorkflowLayout                   src/components/WorkflowLayout.tsx
    ├── WorkflowHeader               src/components/WorkflowHeader.tsx
    ├── workflow name breadcrumb     (inline nav in WorkflowLayout)
    ├── StatusFilterBar              src/components/StatusFilterBar.tsx
    │
    ├── WorkflowView                 src/pages/WorkflowView.tsx
    │   └── GraphContainer           src/components/GraphContainer.tsx
    │       ├── GraphView            src/components/GraphView.tsx
    │       │   └── StepNode[]       src/components/StepNode.tsx
    │       └── GridFallback         src/components/GridFallback.tsx
    │           └── StepCard[]       src/components/StepCard.tsx
    │
    ├── StepView                     src/pages/StepView.tsx
    │   ├── step breadcrumbs         (inline nav in StepView)
    │   ├── GraphContainer           (if step has children)
    │   └── LeafDetail               src/components/LeafDetail.tsx
    │
    └── LogPanel                     src/components/LogPanel.tsx
            └── LogLine[]            src/components/LogLine.tsx
```

---

## Shared Infrastructure

### `src/lib/types.ts`

Defines all TypeScript interfaces shared across the frontend: `StepStatus`, `WorkflowDetail`, `Step`, `StepDetail`, `StepsResponse`, `StepDetailResponse`, `LogLine`, `LogsResponse`, and `Dependency`.

### `src/lib/api.ts`

Typed fetch wrappers for every API endpoint — `uploadWorkflow`, `getWorkflow`, `getSteps`, `getStepDetail`, `getLogs`. All requests go to `/api` which Vite proxies to `:3001` in dev and nginx forwards in production.

`uploadWorkflow` normalizes the `details` field from error responses, which the API may return as either a string or array depending on the validation failure type.

### `src/lib/format.ts`

Two pure functions: `formatElapsed(startTime, endTime)` returns human-readable duration (`2s`, `4m 30s`, `1h 2m`), and `formatRelative(dateString)` returns a relative timestamp (`2 hours ago`). Used in `StepNode`, `StepCard`, `LeafDetail`, and `WorkflowHeader`.

### `src/store/workflowStore.ts`

Zustand store holding all transient UI state:

- **Log panel**: `logPanelOpen`, `toggleLogPanel`, `logStepPath`, `setLogStepPath`, `logFilter`, `setLogFilter`
- **Step filter**: `statusFilter`, `setStatusFilter`
- **View mode**: `viewMode` (`"dagre"` | `"grid"`), `setViewMode`

TanStack Query owns all server state. Zustand holds only UI state that isn't derivable from the URL or server responses.

---

## Component Specifications

### `UploadPage` — `src/pages/UploadPage.tsx`

Landing page. Renders a centered `UploadForm` with a title and tagline. No data fetching.

### `UploadForm` — `src/components/UploadForm.tsx`

Drag-and-drop upload zone that accepts `.json` files. Handles three interactions:

- **File input change** (`<input type="file">` with hidden input, click-triggered from the drop zone div)
- **Drag and drop** onto the styled drop zone
- **Click** on the drop zone opens the file picker

On file selection, reads the file and calls `uploadWorkflow` from `src/lib/api.ts`. On success (201), navigates to the `viewUrl` from the response. On API error (400), displays the `details` field (normalized to an array) in an error box. On network error, shows a generic message. Uses a loading state to disable the zone and show a spinner during upload.

The drop zone element has `data-testid="upload"` and `className="upload-dropzone"` for test targeting.

### `WorkflowLayout` — `src/components/WorkflowLayout.tsx`

Parent route wrapper for all `/workflows/*` routes. Fetches workflow detail once via `useQuery(['workflow', workflowId], staleTime: Infinity)` and renders:

1. `WorkflowHeader` with the fetched workflow data
2. A `<nav>` with the workflow name as a `<Link>` back to `/workflows/:workflowId` — this link is always present regardless of nesting depth, so breadcrumb navigation back to the top level always works
3. `StatusFilterBar`
4. A `<div>` containing the `<Outlet>` (either `WorkflowView` or `StepView`)
5. `LogPanel` fixed to the bottom of the viewport

`WorkflowLayout` passes `{ workflow }` to child routes via React Router's outlet context.

Loading and error states are handled with full-viewport overlays before rendering the layout.

### `WorkflowHeader` — `src/components/WorkflowHeader.tsx`

Horizontal dark bar at the top of every workflow view. Shows:

- `StatusBadge` for the workflow's overall status
- Workflow name in bold
- Metadata pills for `repository`, `branch`, and truncated `commit` (7 chars) from `workflow.metadata`
- Relative upload timestamp right-aligned, using `formatRelative`

Only metadata keys that are present are rendered, so sparse metadata objects display cleanly.

### `StatusFilterBar` — `src/components/StatusFilterBar.tsx`

Row of five labeled checkboxes (`passed`, `failed`, `running`, `skipped`, `cancelled`), each colored with its status color. Toggling a checkbox updates `statusFilter` in the Zustand store. An empty `statusFilter` array means "show all". A "Clear" button appears when any filter is active.

### `StatusBadge` — `src/components/StatusBadge.tsx`

A colored circle (`border-radius: 50%`). Status-to-color mapping:

| Status    | Color  |
| --------- | ------ |
| passed    | Green  |
| failed    | Red    |
| running   | Blue   |
| skipped   | Gray   |
| cancelled | Yellow |

Used in `StepNode`, `StepCard`, `LeafDetail`, and `WorkflowHeader`.

### `GraphContainer` — `src/components/GraphContainer.tsx`

Fetches steps for the current hierarchy level using `useInfiniteQuery(['steps', workflowId, parentId])`, accumulating all pages. Applies `statusFilter` from the Zustand store client-side.

Rendering decision:
- If total step count > 10,000 **or** `viewMode === 'grid'`: renders `GridFallback`
- Otherwise: renders `GraphView` with the filtered steps and their dependency edges (edges are filtered to only connect steps that passed the status filter)

Handles loading, error (with retry button), and empty states inline.

### `GraphView` — `src/components/GraphView.tsx`

Computes a top-to-bottom dagre layout from the steps and dependencies, then renders a React Flow canvas. Each step becomes a `StepNode` (custom node type). Each dependency becomes a React Flow edge styled gray by default, or red if the target step has status `"failed"`. The canvas calls `fitView` on initial render.

The `hierarchyPath` for each step is constructed locally — `/<stepId>` for top-level steps, or `<parentPath>/<stepId>` for nested steps — using the `parentPath` prop passed down from `WorkflowView` or `StepView`. This avoids an extra API call to look up the path before opening the log panel.

React Flow's required CSS (`reactflow/dist/style.css`) is imported inside `GraphView`.

### `StepNode` — `src/components/StepNode.tsx`

Custom React Flow node. Displays a `StatusBadge`, the step name (truncated to 30 chars with the full name in a `title` tooltip), elapsed time from `formatElapsed`, and a "N steps" child count badge when `childCount > 0`.

Click behavior (implemented in the node's `onClick`):
- **Non-leaf step**: navigates to `/workflows/:workflowId/steps/:uuid` via React Router
- **Leaf step**: sets `logStepPath` to the step's `hierarchyPath` in the Zustand store and opens the log panel if it is not already open

### `GridFallback` — `src/components/GridFallback.tsx`

Used when a level has more than 10,000 steps. Renders a CSS grid of `StepCard` items. Steps are sorted by status priority (failed → running → passed → skipped → cancelled) so failures surface first. A search input above the grid filters by step name (substring, case-insensitive). `StatusFilterBar` checkboxes apply as a secondary filter.

### `StepCard` — `src/components/StepCard.tsx`

Compact step representation for the grid view. Shows `StatusBadge`, name, and elapsed time in a single row. Click behavior is identical to `StepNode`.

### `StepView` — `src/pages/StepView.tsx`

Fetches step detail via `useQuery(['stepDetail', workflowId, uuid], staleTime: Infinity)`, which returns the step's `hierarchyPath`, `depth`, and a `breadcrumbs` array of `{ uuid, name }` objects from the API.

Renders a step breadcrumb trail immediately below the layout's workflow-name breadcrumb. Each breadcrumb except the last is a `<Link>` to that step's URL; the last is plain text (current step). This is separate from `WorkflowLayout`'s breadcrumb so the layout doesn't need to know about the step detail query.

Content below the breadcrumbs:
- **Non-leaf step**: renders `GraphContainer` with `parentId=uuid` and `parentPath=step.hierarchyPath`
- **Leaf step**: renders `LeafDetail`

### `LeafDetail` — `src/components/LeafDetail.tsx`

Metadata table for a leaf step: status, start time, end time, elapsed time, hierarchy path, and depth. On mount, sets `logStepPath` to the step's `hierarchyPath` and opens the log panel so the logs are immediately visible when navigating to a leaf.

### `LogPanel` — `src/components/LogPanel.tsx`

Fixed-bottom panel always mounted inside `WorkflowLayout`. Controlled entirely by Zustand (`logPanelOpen`, `logStepPath`, `logFilter`).

When collapsed: shows only a 40px header bar with an "▲ Logs" toggle button and the current `logStepPath` in monospace.

When open: the panel expands to `panelHeight` (default 300px, user-resizable by dragging the top edge). Fetches logs with `useInfiniteQuery(['logs', workflowId, stepPath])`, loading more pages as the user scrolls to the bottom of the log content area. Renders `LogLine` components for each line. A text filter input filters lines client-side. Auto-scrolls to the bottom when new lines load unless the user has manually scrolled up.

The element has `data-testid="log-panel"` and `className="log-panel"` for test targeting.

### `LogLine` — `src/components/LogLine.tsx`

Single log line with two parts: a step label (`[stepId]`) colored per-step using a cycling palette, and the log text. Renders in a monospace font with `white-space: pre-wrap` so multi-line content displays correctly.

---

## Interaction Flows

### Upload Flow

The user drops or selects a `.json` file on the `UploadForm`. The form reads the file text, POSTs it to `/api/workflows`, and navigates to `/workflows/:workflowId` on success. On API error, the response's `details` field (normalized to an array) is rendered inline. The user remains on the upload page for any error — no navigation occurs.

### DAG Navigation Flow

`WorkflowLayout` fetches workflow metadata once. `WorkflowView` mounts `GraphContainer` with no `parentId`, showing top-level steps. Clicking a non-leaf `StepNode` navigates to `/workflows/:workflowId/steps/:uuid`. `StepView` fetches step detail, then mounts a new `GraphContainer` scoped to that step's children. The browser history stack grows normally, so back/forward navigation works without any special handling.

### Log Panel Flow

The log panel is always present but collapsed. It opens when:
- The user clicks the "▲ Logs" toggle button
- The user clicks a leaf `StepNode` in the graph (opens panel and scopes logs to that step)
- `LeafDetail` mounts (opens panel automatically on navigation to a leaf step)

`logStepPath` in the Zustand store determines which logs are fetched. Changing the path (by clicking a different step) invalidates the current log query and loads fresh logs.

### Breadcrumb Navigation Flow

Two layers of breadcrumbs are visible when on a step view:
1. `WorkflowLayout` always renders the workflow name as a `<Link>` to the top-level workflow URL.
2. `StepView` renders the `breadcrumbs` array from the step detail API as `> Parent > Current Step`, where each ancestor is a link and the current step is plain text.

Clicking the workflow name returns to the top-level DAG. Clicking an ancestor step in the step breadcrumbs navigates to that step's sub-step view.

---

## Large Step Count Strategy

When a hierarchy level exceeds 10,000 steps, `GraphContainer` switches from `GraphView` to `GridFallback`. This avoids the quadratic cost of dagre layout and React Flow's node rendering at that scale.

`GridFallback` sorts steps by failure priority so problems are immediately visible, filters by name search and status checkboxes, and renders in a CSS auto-fill grid. Each `StepCard` is clickable with the same behavior as `StepNode`.

---

## Error & Loading States

| State                          | Component        | Behavior                                              |
| ------------------------------ | ---------------- | ----------------------------------------------------- |
| Workflow fetch loading         | `WorkflowLayout` | Full-viewport "Loading workflow..." overlay           |
| Workflow not found             | `WorkflowLayout` | "Workflow not found" with link to upload page         |
| Steps fetch loading            | `GraphContainer` | Centered "Loading steps..." message                   |
| Steps fetch error              | `GraphContainer` | Error message with retry button                       |
| Log fetch loading              | `LogPanel`       | "Loading logs..." message in log body                 |
| Empty steps at level           | `GraphContainer` | "No steps at this level." message                     |
| Upload in progress             | `UploadForm`     | Drop zone shows spinner and "Uploading..." text       |
| Upload error (API 400)         | `UploadForm`     | Error box with `details` array from API response      |
| Upload error (network/5xx)     | `UploadForm`     | Generic error message                                 |

---

## Production Build

The `ui/Dockerfile` builds the Vite app with Bun and serves the resulting `dist/` directory via nginx. Nginx is configured with:

- `try_files $uri $uri/ /index.html` so all unknown paths return the SPA shell (enabling deep-linking to `/workflows/:id` and `/workflows/:id/steps/:uuid` without a 404)
- A proxy pass for `/api` requests forwarded to the Express API service at `:3001`

See [`Dockerfile`](Dockerfile) and [`nginx.conf`](nginx.conf) for the full configuration.

---

## Running Tests

Frontend E2E tests use Playwright against the production nginx-served build. All three services (postgres, api, ui) must be running:

```
docker compose up -d
bun run test:e2e-frontend   # from the repo root
```

Tests cover: SPA hydration, upload flow, DAG rendering, header metadata, status badges, step navigation, breadcrumbs, log panel, deep linking, browser history, validation errors, and elapsed time display. See [`/tests/e2e-tests-frontend.ts`](../tests/e2e-tests-frontend.ts) for the full test suite.
