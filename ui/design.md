# Technical Design: Frontend (Vite + React SPA)

## Overview

The frontend is a single-page application that lets users upload workflow JSON files, navigate to previously uploaded workflows by ID, and visualize the resulting step hierarchy as an interactive DAG. It communicates exclusively with the Hono API server (`workflow-server`) described in [`workflow-server/design.md`](../workflow-server/design.md). The root [`design.md`](../design.md) covers system architecture, upload schema, and technology choices.

---

## Tech Stack

| Library                      | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| Vite + React 18 (TypeScript) | SPA build & runtime (built with Bun)                         |
| React Router v7              | Client-side routing with nested layout routes                |
| React Flow v11               | DAG canvas with pan/zoom, custom nodes, and edge styling     |
| dagre                        | Automatic DAG layout (topological top-to-bottom)             |
| Zustand                      | Lightweight global UI state                                  |
| TanStack Query v5            | Data fetching, caching, cursor-based pagination              |

Styling uses inline styles throughout. No CSS framework is used.

---

## Route Structure

```
/                                                → UploadPage (landing)
/workflows/:workflowId                           → WorkflowView (top-level DAG)
/workflows/:workflowId/steps/:uuid               → StepView (sub-step DAG or leaf detail)
/workflows/:workflowId/logs?stepPath=             → LogsPage (dedicated full-page log viewer)
```

The `/workflows/:workflowId` and `/workflows/:workflowId/steps/:uuid` routes are nested under `WorkflowLayout` as a React Router parent route. `WorkflowLayout` fetches workflow metadata once and renders a shared chrome (header, breadcrumb, status filter) around the route outlet.

`LogsPage` is a standalone route (not nested under `WorkflowLayout`) that provides a full-viewport log viewing experience.

---

## Component Tree

```
App                                  src/App.tsx
├── UploadPage                       src/pages/UploadPage.tsx
│   ├── UploadForm                   src/components/UploadForm.tsx
│   └── NavigateForm                 src/components/NavigateForm.tsx
│
├── WorkflowLayout                   src/components/WorkflowLayout.tsx
│   ├── WorkflowHeader               src/components/WorkflowHeader.tsx
│   ├── unified breadcrumb bar       (inline nav in WorkflowLayout)
│   ├── StatusFilterBar              src/components/StatusFilterBar.tsx
│   │
│   ├── WorkflowView                 src/pages/WorkflowView.tsx
│   │   ├── InfoCard                 src/components/InfoCard.tsx
│   │   └── GraphContainer           src/components/GraphContainer.tsx
│   │       ├── GraphView            src/components/GraphView.tsx
│   │       │   └── StepNode[]       src/components/StepNode.tsx
│   │       └── GridFallback         src/components/GridFallback.tsx
│   │           └── StepCard[]       src/components/StepCard.tsx
│   │
│   └── StepView                     src/pages/StepView.tsx
│       ├── InfoCard                 src/components/InfoCard.tsx
│       ├── GraphContainer           (if step has children)
│       └── LeafDetail               src/components/LeafDetail.tsx
│
└── LogsPage                         src/pages/LogsPage.tsx
        └── LogLine[]                src/components/LogLine.tsx
```

---

## Shared Infrastructure

### `src/lib/types.ts`

Defines all TypeScript interfaces shared across the frontend: `StepStatus`, `Metadata`, `WorkflowDetail`, `Step`, `StepDetail`, `StepsResponse`, `StepDetailResponse`, `LogLine`, `LogsResponse`, and `Dependency`.

The `Metadata` interface captures the standardized metadata fields:

```typescript
interface Metadata {
  name: string;
  uri?: string;
  pin?: string;
  startTime?: string;
  endTime?: string;
}
```

### `src/lib/api.ts`

Typed fetch wrappers for every API endpoint — `uploadWorkflow`, `getWorkflow`, `getSteps`, `getStepDetail`, `lookupStep`, `getLogs`. All requests go to `/api` which Vite proxies to `:3001` in dev and nginx forwards in production.

`lookupStep(uuid)` calls `GET /api/steps/:uuid` to resolve a step UUID to its workflow ID and step detail. This is used by `NavigateForm` when the user enters a step UUID without knowing the workflow.

`uploadWorkflow` normalizes the `details` field from error responses, which the API may return as either a string or array depending on the validation failure type.

### `src/lib/format.ts`

Pure functions: `formatElapsed(startTime, endTime)` returns human-readable duration (`2s`, `4m 30s`, `1h 2m`), `formatRelative(dateString)` returns a relative timestamp (`2 hours ago`), and `formatLocalTime(dateString)` returns a date/time string in the user's local timezone. Used in `StepNode`, `StepCard`, `LeafDetail`, `InfoCard`, and `WorkflowHeader`.

### `src/store/workflowStore.ts`

Zustand store holding all transient UI state:

- **Step filter**: `statusFilter`, `setStatusFilter`
- **View mode**: `viewMode` (`"dagre"` | `"grid"`), `setViewMode`
- **Breadcrumbs**: `stepBreadcrumbs` (array of `{ uuid, name }`), `setStepBreadcrumbs`

TanStack Query owns all server state. Zustand holds only UI state that isn't derivable from the URL or server responses.

---

## Component Specifications

### `UploadPage` — `src/pages/UploadPage.tsx`

Landing page. Renders a centered layout with:
1. A title and tagline
2. `UploadForm` for uploading workflow JSON files
3. `NavigateForm` for navigating to a workflow or step by ID

No data fetching.

### `UploadForm` — `src/components/UploadForm.tsx`

Drag-and-drop upload zone that accepts `.json` files. Handles three interactions:

- **File input change** (`<input type="file">` with hidden input, click-triggered from the drop zone div)
- **Drag and drop** onto the styled drop zone
- **Click** on the drop zone opens the file picker

On file selection, reads the file and calls `uploadWorkflow` from `src/lib/api.ts`. On success (201), navigates to the `viewUrl` from the response. On API error (400), displays the `details` field (normalized to an array) in an error box. On network error, shows a generic message. Uses a loading state to disable the zone and show a spinner during upload.

The drop zone element has `data-testid="upload"` and `className="upload-dropzone"` for test targeting.

### `NavigateForm` — `src/components/NavigateForm.tsx`

A form with a text input and "Go" button that lets the user enter a workflow ID or step UUID to navigate directly to it. The form accepts two formats:

- **Workflow ID** (UUID): navigates to `/workflows/:workflowId`
- **Step UUID**: calls `lookupStep` (`GET /api/steps/:uuid`) to resolve the step's workflow ID, then navigates to `/workflows/:workflowId/steps/:uuid`

Displays an error message if the ID is not found or the format is invalid.

### `WorkflowLayout` — `src/components/WorkflowLayout.tsx`

Parent route wrapper for all `/workflows/*` routes. Fetches workflow detail once via `useQuery(['workflow', workflowId], staleTime: Infinity)` and renders:

1. `WorkflowHeader` with the fetched workflow data
2. A unified breadcrumb `<nav>` that reads `stepBreadcrumbs` from the Zustand store and renders the full workflow-to-step path. When `stepBreadcrumbs` is empty (at workflow level), the workflow name is shown as highlighted plain text. Otherwise the workflow name is a `<Link>` back to the top level, followed by each step crumb — all but the last as links, the last as highlighted text.
3. `StatusFilterBar`
4. A `<div>` containing the `<Outlet>` (either `WorkflowView` or `StepView`)

`WorkflowLayout` passes `{ workflow }` to child routes via React Router's outlet context.

Loading and error states are handled with full-viewport overlays before rendering the layout.

### `WorkflowHeader` — `src/components/WorkflowHeader.tsx`

Horizontal dark bar at the top of every workflow view. Shows:

- A **home link** (app name or logo) that navigates to `/` (the landing page)
- `StatusBadge` for the workflow's overall status
- Workflow name in bold
- Relative upload timestamp right-aligned, using `formatRelative`

The home link provides a persistent way to return to the landing page from any workflow or step view.

### `InfoCard` — `src/components/InfoCard.tsx`

A card component that displays standardized metadata for the current workflow or step. Accepts a `metadata` prop with `{ name, uri?, pin?, startTime?, endTime? }` and renders:

- **Name** in bold as the card title
- **URI** as a monospace string (if present)
- **Pin** as a monospace string (if present)
- **Start Time** formatted in local timezone using `formatLocalTime` (if present)
- **End Time** formatted in local timezone using `formatLocalTime` (if present)
- **Duration** computed from start and end times using `formatElapsed` (if both present)

Fields that are not provided in the data are omitted entirely — no blank rows are shown. The card uses a subtle border and background to visually separate it from the graph/content area below.

Used in both `WorkflowView` (for workflow metadata) and `StepView` (for step metadata).

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

Used in `StepNode`, `StepCard`, `LeafDetail`, `InfoCard`, and `WorkflowHeader`.

### `GraphContainer` — `src/components/GraphContainer.tsx`

Fetches steps for the current hierarchy level using `useQuery(['steps', workflowId, parentId, cursor])`, loading one page at a time. Applies `statusFilter` from the Zustand store client-side.

Rendering decision:
- If total step count > 10,000 **or** `viewMode === 'grid'`: renders `GridFallback`
- Otherwise: renders `GraphView` with the filtered steps and their dependency edges (edges are filtered to only connect steps that passed the status filter)

Displays a **"View Logs"** link that navigates to `/workflows/:workflowId/logs?stepPath=<currentPath>` to view merged logs for all steps at the current level.

Handles loading, error (with retry button), and empty states inline.

### `GraphView` — `src/components/GraphView.tsx`

Computes a top-to-bottom dagre layout from the steps and dependencies, then renders a React Flow canvas. Each step becomes a `StepNode` (custom node type). Each dependency becomes a React Flow edge styled gray by default, or red if the target step has status `"failed"`. The canvas calls `fitView` on initial render.

The `hierarchyPath` for each step is constructed locally — `/<stepId>` for top-level steps, or `<parentPath>/<stepId>` for nested steps — using the `parentPath` prop passed down from `WorkflowView` or `StepView`. This avoids an extra API call to look up the path before navigating to the log viewer.

React Flow's required CSS (`reactflow/dist/style.css`) is imported inside `GraphView`.

### `StepNode` — `src/components/StepNode.tsx`

Custom React Flow node. Displays a `StatusBadge`, the step name (truncated to 30 chars with the full name in a `title` tooltip), elapsed time from `formatElapsed`, and a "N steps" child count badge when `childCount > 0`.

Click behavior (implemented in the node's `onClick`):
- **Non-leaf step**: navigates to `/workflows/:workflowId/steps/:uuid` via React Router
- **Leaf step**: navigates to `/workflows/:workflowId/logs?stepPath=<hierarchyPath>` to view the step's logs in the dedicated log viewer

### `GridFallback` — `src/components/GridFallback.tsx`

Used when a level has more than 10,000 steps or the user selects grid view. Renders a CSS grid of `StepCard` items with **page-based pagination**: displays one page of results at a time (default page size configurable, e.g. 100 items) with "Previous" / "Next" navigation buttons and a page indicator. Steps are sorted by status priority (failed → running → passed → skipped → cancelled) so failures surface first. A search input above the grid filters by step name (substring, case-insensitive). `StatusFilterBar` checkboxes apply as a secondary filter.

Page-based rendering replaces the previous infinite scroll approach, which caused UI sluggishness when progressively loading large numbers of steps into a single page.

### `StepCard` — `src/components/StepCard.tsx`

Compact step representation for the grid view. Shows `StatusBadge`, name, and elapsed time in a single row. Click behavior is identical to `StepNode`.

### `StepView` — `src/pages/StepView.tsx`

Fetches step detail via `useQuery(['stepDetail', workflowId, uuid], staleTime: Infinity)`, which returns the step's `hierarchyPath`, `depth`, metadata (`name`, `uri`, `pin`, `startTime`, `endTime`), and a `breadcrumbs` array of `{ uuid, name }` objects from the API.

On load, calls `setStepBreadcrumbs(breadcrumbs)` from the Zustand store so `WorkflowLayout` renders the full unified breadcrumb bar. Step breadcrumbs are no longer rendered inside `StepView`.

Content:
- **`InfoCard`** displaying the step's metadata (name, URI, pin, start/end times, duration)
- **Non-leaf step**: renders `GraphContainer` with `parentId=uuid` and `parentPath=step.hierarchyPath`, plus a "View Logs" link to `/workflows/:workflowId/logs?stepPath=<hierarchyPath>`
- **Leaf step**: renders `LeafDetail`, plus a "View Logs" link to the dedicated log viewer

### `LeafDetail` — `src/components/LeafDetail.tsx`

Metadata table for a leaf step: status, hierarchy path, and depth. A prominent "View Logs" link navigates to `/workflows/:workflowId/logs?stepPath=<hierarchyPath>` for the dedicated log viewing experience.

### `LogsPage` — `src/pages/LogsPage.tsx`

A standalone full-page route (`/workflows/:workflowId/logs?stepPath=`) for viewing logs. Not nested under `WorkflowLayout` — it has its own minimal header with a back link to the workflow/step that linked here.

Features:
- **Full viewport**: the log content area fills the entire viewport below a compact header
- **Page-based navigation**: fetches one page of log lines at a time using `useQuery(['logs', workflowId, stepPath, cursor])`. "Previous" / "Next" buttons and a page indicator let the user move between pages. This avoids the performance issues of infinite scroll with large log volumes.
- **Text filter**: an input field filters displayed lines client-side (substring match)
- **Log rendering**: each line is rendered as a `LogLine` component
- **Header**: shows the step path, workflow name, and a link back to the referring view

The element has `data-testid="logs-page"` for test targeting.

### `LogLine` — `src/components/LogLine.tsx`

Single log line with two parts: a step label (`[stepId]`) colored per-step using a cycling palette, and the log text. Renders in a monospace font with `white-space: pre-wrap` so multi-line content displays correctly.

---

## Interaction Flows

### Upload Flow

The user drops or selects a `.json` file on the `UploadForm`. The form reads the file text, POSTs it to `/api/workflows`, and navigates to `/workflows/:workflowId` on success. On API error, the response's `details` field (normalized to an array) is rendered inline. The user remains on the upload page for any error — no navigation occurs.

### Navigate-by-ID Flow

The user enters a workflow ID or step UUID in the `NavigateForm` on the landing page. For workflow IDs, the app navigates directly to `/workflows/:workflowId`. For step UUIDs, the app looks up the step's workflow via the API, then navigates to `/workflows/:workflowId/steps/:uuid`. Invalid or expired IDs show an error message inline.

### DAG Navigation Flow

`WorkflowLayout` fetches workflow metadata once. `WorkflowView` mounts `GraphContainer` with no `parentId`, showing top-level steps. Clicking a non-leaf `StepNode` navigates to `/workflows/:workflowId/steps/:uuid`. `StepView` fetches step detail, then mounts a new `GraphContainer` scoped to that step's children. The browser history stack grows normally, so back/forward navigation works without any special handling.

### Log Viewer Flow

The user navigates to the dedicated log viewer from:
- The "View Logs" link in `GraphContainer` (merged logs for a hierarchy level)
- The "View Logs" link in `StepView` / `LeafDetail` (logs for a specific step and its descendants)
- Clicking a leaf `StepNode` in the graph (navigates directly to the log viewer for that step)

`LogsPage` reads `stepPath` from the URL query string and fetches one page of logs at a time. The user navigates between pages using prev/next controls.

### Breadcrumb Navigation Flow

A single unified breadcrumb bar in `WorkflowLayout` shows the full path from the workflow root to the current view:

- At the workflow level (`WorkflowView` mounted): `WorkflowView` clears `stepBreadcrumbs` on mount, so only the workflow name appears (highlighted, no link).
- At a step level (`StepView` mounted): `StepView` calls `setStepBreadcrumbs(breadcrumbs)` on load; `WorkflowLayout` re-renders to show workflow name (as a link) `>` ancestor steps (as links) `>` current step (highlighted).

Clicking the workflow name navigates to `/workflows/:workflowId`. Clicking an ancestor step navigates to that step's sub-step view, triggering a new `StepView` mount and breadcrumb update.

### Home Navigation Flow

The `WorkflowHeader` includes a home link that navigates to `/` from any workflow or step view. This provides a persistent way to return to the upload/search landing page.

---

## Large Step Count Strategy

When a hierarchy level exceeds 10,000 steps, `GraphContainer` switches from `GraphView` to `GridFallback`. This avoids the quadratic cost of dagre layout and React Flow's node rendering at that scale.

`GridFallback` renders one page of steps at a time with prev/next navigation, sorts steps by failure priority so problems are immediately visible, filters by name search and status checkboxes, and renders in a CSS auto-fill grid. Each `StepCard` is clickable with the same behavior as `StepNode`.

---

## Error & Loading States

| State                          | Component        | Behavior                                              |
| ------------------------------ | ---------------- | ----------------------------------------------------- |
| Workflow fetch loading         | `WorkflowLayout` | Full-viewport "Loading workflow..." overlay           |
| Workflow not found             | `WorkflowLayout` | "Workflow not found" with link to upload page         |
| Steps fetch loading            | `GraphContainer` | Centered "Loading steps..." message                   |
| Steps fetch error              | `GraphContainer` | Error message with retry button                       |
| Log fetch loading              | `LogsPage`       | "Loading logs..." message in log body                 |
| Empty steps at level           | `GraphContainer` | "No steps at this level." message                     |
| Upload in progress             | `UploadForm`     | Drop zone shows spinner and "Uploading..." text       |
| Upload error (API 400)         | `UploadForm`     | Error box with `details` array from API response      |
| Upload error (network/5xx)     | `UploadForm`     | Generic error message                                 |
| Navigate ID not found          | `NavigateForm`   | Inline error "Workflow/step not found"                |

---

## Production Build

The `ui/Dockerfile` builds the Vite app with Bun and serves the resulting `dist/` directory via nginx. Nginx is configured with:

- `try_files $uri $uri/ /index.html` so all unknown paths return the SPA shell (enabling deep-linking to `/workflows/:id`, `/workflows/:id/steps/:uuid`, and `/workflows/:id/logs` without a 404)
- A proxy pass for `/api` requests forwarded to the Hono API service at `:3001`

See [`Dockerfile`](Dockerfile) and [`nginx.conf`](nginx.conf) for the full configuration.

---

## Running Tests

Frontend E2E tests use Playwright against the production nginx-served build. All three services (postgres, api, ui) must be running:

```
docker compose up -d
bun run test:e2e-frontend   # from the repo root
```

Tests cover: SPA hydration, upload flow, navigate-by-ID, DAG rendering, header metadata, info card, status badges, step navigation, breadcrumbs, dedicated log viewer, deep linking, browser history, validation errors, and elapsed time display. See [`/tests/e2e-tests-frontend.ts`](../tests/e2e-tests-frontend.ts) for the full test suite.
