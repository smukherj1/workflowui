# Technical Design: Frontend (Vite + React SPA)

## Overview

The frontend is a single-page application that lets users upload workflow JSON files and visualize the resulting step hierarchy as an interactive DAG. It communicates exclusively with the Express API server (`ui/server`) described in [`ui/server/design.md`](server/design.md). The root [`design.md`](../design.md) covers system architecture, upload schema, and technology choices.

This document covers implementation phases 4–7: frontend shell, graph view, log panel, and polish.

---

## Tech Stack

| Library                      | Purpose                                            |
| ---------------------------- | -------------------------------------------------- |
| Vite + React 18 (TypeScript) | SPA build & runtime                                |
| React Router v7              | Client-side routing                                |
| React Flow                   | DAG canvas with pan/zoom and virtualized rendering |
| @dagrejs/dagre               | Automatic DAG layout (topological left-to-right)   |
| Zustand                      | Lightweight global state                           |
| TanStack Query (React Query) | Data fetching, caching, background refetching      |
| @tanstack/react-virtual      | Virtualized log line rendering                     |
| Tailwind CSS                 | Utility-first styling                              |

---

## Route Structure

```
/                                    → UploadPage
/workflows/:workflowId              → WorkflowView (top-level DAG)
/workflows/:workflowId/steps/:uuid  → StepView (sub-step DAG or leaf detail)
```

All routes under `/workflows` share a common `WorkflowLayout` wrapper that provides the `WorkflowHeader` and `Breadcrumbs`.

---

## Component Tree

```
App
├── UploadPage
│   └── UploadForm
│       └── DropZone
│       └── ValidationErrors
│
└── WorkflowLayout                   (shared layout for workflow routes)
    ├── WorkflowHeader
    ├── Breadcrumbs
    ├── StatusFilterBar
    │
    ├── WorkflowView                 (route: /workflows/:workflowId)
    │   └── GraphContainer
    │       ├── GraphView            (React Flow canvas, if ≤ 10K steps)
    │       │   └── StepNode[]       (custom React Flow nodes)
    │       └── GridFallback         (filterable grid, if > 10K steps)
    │           └── StepCard[]
    │
    ├── StepView                     (route: /workflows/:workflowId/steps/:uuid)
    │   ├── GraphContainer           (if step has children — same as above)
    │   └── LeafDetail               (if step is a leaf)
    │       └── StepMetadata
    │
    └── LogPanel                     (slide-up drawer, shared across views)
        └── VirtualLogList
            └── LogLine[]
```

---

## Component Specifications

### `UploadPage`

The landing page. Contains the `UploadForm` and nothing else.

### `UploadForm`

- Renders a drag-and-drop zone (`DropZone`) that accepts `.json` files.
- On file selection, reads the file client-side and `POST`s to `/api/workflows`.
- Displays a loading spinner during upload.
- On `201`: navigates to `/workflows/:workflowId` using the `viewUrl` from the response.
- On `400`: displays validation errors from the response `details` field in a `ValidationErrors` list.
- On network/server errors: displays a generic error banner.

### `WorkflowLayout`

Wraps all `/workflows/*` routes. Fetches workflow detail via `GET /api/workflows/:id` (TanStack Query, `staleTime: Infinity` since workflow data is immutable after upload). Provides:

- `WorkflowHeader` — workflow name, repository, branch, commit, overall status badge, upload time.
- `Breadcrumbs` — built from the step detail API's `breadcrumbs` array when on a `/steps/:uuid` route; just the workflow name on the top-level route.
- `StatusFilterBar` — checkboxes for each status (`passed`, `failed`, `running`, `skipped`, `cancelled`). Filtering is applied client-side to the fetched steps array.

### `GraphContainer`

Decides between `GraphView` and `GridFallback` based on step count:

1. Fetches steps at the current hierarchy level via `GET /api/workflows/:id/steps?parentId=`. For the top-level view, `parentId` is omitted.
2. If `steps.length <= 10_000`: renders `GraphView`.
3. If `steps.length > 10_000`: renders `GridFallback`.

Cursor-based pagination is used when there are more steps than fit in a single response. All pages are fetched and accumulated before rendering (TanStack Query `useInfiniteQuery`).

### `GraphView`

- Uses `@dagrejs/dagre` to compute node positions from the steps + dependencies.
- Layout direction: left-to-right (`rankdir: 'LR'`).
- Each step becomes a dagre node; each dependency becomes a dagre edge.
- Converts dagre output to React Flow nodes/edges.
- Edges are color-coded: default gray, red if the target step failed.
- Fits view on initial render (`fitView`).
- Nodes use the custom `StepNode` component.

### `StepNode`

Custom React Flow node rendered for each step. Displays:

- `StatusBadge` — colored dot/icon: green (passed), red (failed), blue-pulse (running), gray (skipped), yellow (cancelled).
- Step name (truncated to 30 chars with tooltip for full name).
- Elapsed time (computed from `endTime - startTime`, formatted as `Xs`, `Xm Ys`, or `Xh Ym`).
- `childCount` badge if > 0 (indicating drillable).

**Click behavior:**

- If `isLeaf === false`: navigate to `/workflows/:workflowId/steps/:uuid`.
- If `isLeaf === true`: open `LogPanel` scoped to this step's logs.

### `GridFallback`

Used for hierarchy levels with > 10K steps. Renders a virtualized grid of `StepCard` components.

- Groups steps by status (failed first, then running, passed, skipped, cancelled).
- Includes a text search input that filters by step name.
- Status filter from `StatusFilterBar` applies here.

### `StepCard`

Simplified step display for grid view. Shows status badge, name, elapsed time. Click navigates same as `StepNode`.

### `LeafDetail`

Rendered by `StepView` when the current step has `isLeaf === true` and `childCount === 0`.

- Displays `StepMetadata`: status, start time, end time, elapsed time, hierarchy path.
- Automatically opens the `LogPanel` scoped to this step.

### `LogPanel`

A slide-up drawer anchored to the bottom of the viewport. Available on all workflow/step views.

- Toggle button in the toolbar (or keyboard shortcut).
- Resizable height via drag handle.
- Fetches logs via `GET /api/workflows/:id/logs?stepPath=<path>`.
  - On `WorkflowView`: `stepPath` is the root, showing all workflow logs merged.
  - On `StepView` (non-leaf): `stepPath` is the current step's `hierarchyPath`, showing merged descendant logs.
  - On `StepView` (leaf): `stepPath` is the leaf's own `hierarchyPath`.
- Uses cursor-based pagination. Loads initial page, then loads more on scroll-to-bottom via `useInfiniteQuery`.

### `VirtualLogList`

- Uses `@tanstack/react-virtual` to render only visible log lines.
- Each `LogLine` displays: step label (colored by step), log text.
- Text filter input at the top of the panel filters lines client-side (case-insensitive substring match).
- Auto-scrolls to bottom on initial load; pauses auto-scroll when user scrolls up.

### `Breadcrumbs`

- On the top-level workflow view: shows only the workflow name (non-clickable).
- On a step view: uses the `breadcrumbs` array from `GET /api/workflows/:id/steps/:uuid`. Each breadcrumb is a link to that step's view. Format: `Workflow Name > Parent Step > Current Step`.

### `StatusBadge`

Pure presentational component. Maps status string to color:

| Status    | Color        | Tailwind class              |
| --------- | ------------ | --------------------------- |
| passed    | Green        | `bg-green-500`              |
| failed    | Red          | `bg-red-500`                |
| running   | Blue (pulse) | `bg-blue-500 animate-pulse` |
| skipped   | Gray         | `bg-gray-400`               |
| cancelled | Yellow       | `bg-yellow-500`             |

### `WorkflowHeader`

Displays workflow-level metadata in a horizontal bar:

- Workflow name (large text).
- Overall status badge.
- Metadata pills: repository, branch, commit (truncated to 7 chars).
- Upload timestamp (relative, e.g., "2 hours ago").

---

## State Management (Zustand)

```typescript
interface WorkflowStore {
  // Log panel
  logPanelOpen: boolean;
  toggleLogPanel: () => void;
  logStepPath: string | null; // stepPath for current log scope
  setLogStepPath: (path: string | null) => void;
  logFilter: string; // text filter for log lines
  setLogFilter: (filter: string) => void;

  // Status filter
  statusFilter: StepStatus[]; // empty = show all
  setStatusFilter: (statuses: StepStatus[]) => void;

  // Graph/grid mode (auto-determined but can be manually overridden)
  viewMode: "dagre" | "grid";
  setViewMode: (mode: "dagre" | "grid") => void;
}
```

TanStack Query handles all server state (workflow detail, steps, logs). Zustand only holds UI state.

---

## Data Fetching (TanStack Query)

| Query key                          | Endpoint                                 | Options                                       |
| ---------------------------------- | ---------------------------------------- | --------------------------------------------- |
| `['workflow', workflowId]`         | `GET /api/workflows/:id`                 | `staleTime: Infinity`                         |
| `['steps', workflowId, parentId]`  | `GET /api/workflows/:id/steps?parentId=` | `useInfiniteQuery`, paginate via `nextCursor` |
| `['stepDetail', workflowId, uuid]` | `GET /api/workflows/:id/steps/:uuid`     | `staleTime: Infinity`                         |
| `['logs', workflowId, stepPath]`   | `GET /api/workflows/:id/logs?stepPath=`  | `useInfiniteQuery`, paginate via `nextCursor` |

All fetch functions live in `src/lib/api.ts` and return typed responses.

---

## API Client (`src/lib/api.ts`)

```typescript
const API_BASE = "/api";

export async function uploadWorkflow(
  file: File,
): Promise<{ workflowId: string; viewUrl: string }>;
export async function getWorkflow(id: string): Promise<WorkflowDetail>;
export async function getSteps(
  workflowId: string,
  parentId?: string,
  cursor?: string,
): Promise<StepsResponse>;
export async function getStepDetail(
  workflowId: string,
  uuid: string,
): Promise<StepDetailResponse>;
export async function getLogs(
  workflowId: string,
  stepPath: string,
  cursor?: string,
  limit?: number,
): Promise<LogsResponse>;
```

In dev, Vite proxies `/api` to `http://localhost:3001`.

---

## Types (`src/lib/types.ts`)

```typescript
type StepStatus = "passed" | "failed" | "running" | "skipped" | "cancelled";

interface WorkflowDetail {
  id: string;
  name: string;
  metadata: Record<string, string>;
  status: StepStatus;
  totalSteps: number;
  uploadedAt: string;
  expiresAt: string;
}

interface Step {
  uuid: string;
  stepId: string;
  name: string;
  status: StepStatus;
  startTime: string | null;
  endTime: string | null;
  isLeaf: boolean;
  childCount: number;
}

interface Dependency {
  from: string; // step UUID
  to: string; // step UUID
}

interface StepsResponse {
  steps: Step[];
  dependencies: Dependency[];
  nextCursor: string | null;
}

interface StepDetailResponse {
  step: Step & { hierarchyPath: string; depth: number };
  breadcrumbs: Array<{ uuid: string; name: string }>;
}

interface LogLine {
  timestampNs: string;
  line: string;
  stepPath: string;
  stepId: string;
  depth: string;
}

interface LogsResponse {
  lines: LogLine[];
  nextCursor: string | null;
}
```

---

## Source Layout

```
ui/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  tailwind.config.js
  postcss.config.js
  Dockerfile
  design.md                          # This file
  src/
    main.tsx                          # React DOM root, QueryClientProvider, RouterProvider
    App.tsx                           # Route definitions
    lib/
      api.ts                          # Fetch helpers (typed)
      types.ts                        # Shared TypeScript types
      format.ts                       # Time formatting helpers (elapsed, relative)
    store/
      workflowStore.ts                # Zustand store
    pages/
      UploadPage.tsx                  # Landing page with upload form
      WorkflowView.tsx                # Top-level DAG view
      StepView.tsx                    # Sub-step DAG or leaf detail
    components/
      WorkflowLayout.tsx              # Layout wrapper (header, breadcrumbs, log panel)
      WorkflowHeader.tsx              # Workflow metadata bar
      Breadcrumbs.tsx                 # Hierarchy navigation
      UploadForm.tsx                  # Drag-and-drop file upload
      GraphContainer.tsx              # Decides GraphView vs GridFallback
      GraphView.tsx                   # React Flow + dagre layout
      StepNode.tsx                    # Custom React Flow node
      GridFallback.tsx                # Virtualized grid for large step counts
      StepCard.tsx                    # Step card for grid view
      LeafDetail.tsx                  # Leaf step metadata display
      LogPanel.tsx                    # Slide-up log drawer
      VirtualLogList.tsx              # Virtualized log line list
      LogLine.tsx                     # Single log line component
      StatusBadge.tsx                 # Color-coded status indicator
      StatusFilterBar.tsx             # Status checkbox filters
```

---

## Interaction Flows

### Upload Flow

```
User drops .json file on UploadForm
  → UploadForm reads file, POSTs to /api/workflows
  → 201: navigate to /workflows/:workflowId
  → 400: display ValidationErrors with details from response
  → 5xx/network: display error banner
```

### DAG Navigation Flow

```
WorkflowView loads
  → fetch GET /api/workflows/:id (workflow detail for header)
  → fetch GET /api/workflows/:id/steps (top-level steps)
  → GraphContainer renders GraphView or GridFallback

User clicks a non-leaf StepNode
  → navigate to /workflows/:workflowId/steps/:uuid
  → StepView loads
    → fetch GET /api/workflows/:id/steps/:uuid (step detail + breadcrumbs)
    → fetch GET /api/workflows/:id/steps?parentId=:uuid (child steps)
    → GraphContainer renders child DAG

User clicks a leaf StepNode
  → set logStepPath to this step's hierarchyPath
  → open LogPanel
```

### Log Panel Flow

```
LogPanel opens (toggle button or leaf click)
  → fetch GET /api/workflows/:id/logs?stepPath=<current scope>
  → VirtualLogList renders visible lines
  → user scrolls to bottom → fetch next page (cursor pagination)
  → user types in filter → client-side filter applied to fetched lines
```

### Breadcrumb Navigation Flow

```
StepView fetches step detail → response includes breadcrumbs[]
  → Breadcrumbs renders: [Workflow Name] > [Parent 1] > ... > [Current Step]
  → clicking a breadcrumb navigates to /workflows/:workflowId/steps/:crumbUuid
  → clicking workflow name navigates to /workflows/:workflowId
```

---

## Large Step Count Strategy

When a hierarchy level has > 10K steps, dagre layout becomes too expensive and React Flow rendering degrades. The `GraphContainer` switches to `GridFallback`:

- Steps are fetched with `useInfiniteQuery`, accumulating all pages.
- `GridFallback` groups steps by status: failed → running → passed → skipped → cancelled (failed first so users see problems immediately).
- Within each group, steps are sorted by `sort_order`.
- The grid is virtualized with `@tanstack/react-virtual` (fixed row height).
- A search input filters by step name (debounced 200ms).
- `StatusFilterBar` checkboxes filter by status.
- Each `StepCard` is clickable (same behavior as `StepNode`).

---

## Error & Loading States

| State                          | Component        | Behavior                                              |
| ------------------------------ | ---------------- | ----------------------------------------------------- |
| Workflow fetch loading         | `WorkflowLayout` | Skeleton header + spinner                             |
| Workflow not found (404)       | `WorkflowLayout` | "Workflow not found" message with link to upload page |
| Steps fetch loading            | `GraphContainer` | Centered spinner                                      |
| Steps fetch error              | `GraphContainer` | Error message with retry button                       |
| Log fetch loading              | `LogPanel`       | Skeleton lines                                        |
| Log fetch error                | `LogPanel`       | Error message with retry button                       |
| Empty steps (0 steps at level) | `GraphContainer` | "No steps at this level" message                      |
| Upload in progress             | `UploadForm`     | Button disabled, spinner, "Uploading..." text         |

---

## Vite Dev Proxy

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
```

---

## E2E Frontend Test Plan

Frontend e2e tests live at `/tests/e2e-tests-frontend.ts` and run with `bun`. They use **Playwright** to drive a headless Chromium browser against the running UI server. Tests assume the API server, PostgreSQL, and the UI server (Vite dev or nginx prod) are already running.

Backend API endpoint behavior is covered by `/tests/e2e-tests-backend.ts`. The frontend tests focus on what only a browser can verify: rendering, user interaction, navigation, and visual state.

### Test Cases

**1. SPA Serving & Hydration**

- Navigate to `/`. Verify `#root` element exists and React has hydrated (content rendered inside `#root`).

**2. Upload Page Renders**

- Navigate to `/`. Verify the page shows a file input, drop zone, or upload prompt.

**3. File Upload → Workflow View Navigation**

- On the upload page, set a `.json` fixture on the file input. Verify the browser navigates to a `/workflows/:id` URL after upload completes.

**4. Workflow View Renders DAG Nodes**

- Upload `simple-linear.json` via API, navigate to its view URL. Verify step names ("Checkout", "Build", "Test") are visible in the page.

**5. Workflow Header Shows Metadata**

- Upload `parallel-diamond.json`, navigate to view. Verify the workflow name and metadata (repository or branch) are displayed.

**6. Status Badges Render with Distinct Styles**

- Upload `mixed-status.json` (passed, failed, skipped steps), navigate to view. Verify all three step names are rendered (visual badge styling verified by presence).

**7. Click Non-Leaf Step → Navigates to Sub-Step View**

- Upload `nested-hierarchy.json`, navigate to view. Click "CI" step node. Verify URL changes to `/steps/:uuid` and child steps ("Build Frontend", "Build Backend", "Integration Tests") are rendered.

**8. Breadcrumb Navigation**

- After navigating into CI sub-steps, verify breadcrumbs show hierarchy context. Click workflow name breadcrumb to navigate back to top-level view.

**9. Log Panel Opens**

- Upload `simple-linear.json`, navigate to view. Click a log toggle or a leaf step. Verify log panel or log content becomes visible.

**10. Log Panel Shows Step Logs**

- Upload `simple-linear.json`, navigate to view, click "Checkout" step. Verify the log line "Cloning into repo..." appears in the page.

**11. Client-Side Routing Fallback (Deep Link)**

- Navigate directly to a valid workflow view URL (uploaded via API). Verify the SPA loads and renders content. Also navigate to a nonexistent workflow path and verify a 200 response (SPA shell served, not a server 404).

**12. Browser Back/Forward Navigation**

- Upload `nested-hierarchy.json`, navigate to view, click into CI sub-steps. Press browser back — verify return to workflow view. Press forward — verify return to sub-step view.

**13. Upload Invalid File Shows Error**

- On the upload page, set `invalid-cycle.json` on the file input. Verify the browser does NOT navigate to a workflow view and an error message is displayed.

**14. Step Nodes Show Elapsed Time**

- Upload `simple-linear.json`, navigate to view. Verify time-like patterns (e.g., "2s", "28s") appear in the page.

---

## Docker Build (Production)

```dockerfile
# ui/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
```

Nginx config serves the SPA with:

- `try_files $uri $uri/ /index.html` for client-side routing fallback.
- Proxy pass `/api` to the API service.
