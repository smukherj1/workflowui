# Technical Design: CI/CD Workflow UI

## Context

The workflowui project needs a technical design to implement the PRD at `/PRD.md`. The system lets users upload a JSON execution trace of a CI/CD workflow, then visualize the step hierarchy as a DAG, inspect step metadata, and view merged/scoped logs. The design must handle up to 1M steps per hierarchy level and 50MB of logs per workflow with 7-day retention.

---

## Log Storage: PostgreSQL

Logs are stored directly in PostgreSQL alongside workflow metadata. This simplifies the architecture (no additional services) and avoids issues with dedicated log systems like Loki that reject logs with old timestamps — a problem for this product since users upload historical workflow traces that may have executed hours or days ago.

| Criteria              | ELK                        | Loki + Grafana                              | PostgreSQL                          |
| --------------------- | -------------------------- | ------------------------------------------- | ----------------------------------- |
| RAM baseline          | 8-16 GB                    | 2-4 GB                                      | Shared with metadata DB             |
| Deployment complexity | High (3 services)          | Low (simple config)                         | None (already deployed)             |
| Query model           | Full-text index (overkill) | Label-based (rejects old timestamps)        | SQL (simple, flexible)              |
| Retention config      | Index lifecycle mgmt       | `retention_period` setting                  | CASCADE delete with workflow expiry |
| Historical uploads    | Supported                  | **Not supported** (discards old timestamps) | Fully supported                     |

Access patterns are simple key-based lookups (logs for workflow X, step Y). Logs are bounded at 50MB per workflow and 10MB per leaf step, well within PostgreSQL's capacity. Retention is handled automatically via CASCADE deletes when expired workflows are cleaned up.

---

## System Architecture

```
[Browser] --> [Vite React SPA :5173]
                  |
                  v
              [Express API :3001] --> [PostgreSQL :5432]  (workflow metadata, DAG, logs)
```

- **Vite + React**: SPA frontend for workflow visualization
- **Express (TypeScript)**: REST API server handling uploads, validation, queries
- **PostgreSQL**: Stores workflow metadata, step hierarchy, DAG relationships, and logs

---

## Workflow JSON Upload Schema

```json
{
  "workflow": {
    "name": "my-build-pipeline",
    "metadata": {
      "repository": "org/repo",
      "branch": "main",
      "commit": "abc123"
    },
    "steps": [
      {
        "id": "step-1",
        "name": "Start of the build",
        "status": "passed",
        "startTime": "2026-03-08T10:00:00Z",
        "endTime": "2026-03-08T10:00:05Z",
        "dependsOn": [],
        "logs": "Initializing...\n",
        "steps": []
      }
    ]
  }
}
```

- `status`: `"passed"` | `"failed"` | `"running"` | `"skipped"` | `"cancelled"`
- `dependsOn`: references sibling step IDs only (same hierarchy level)
- `logs`: string for leaf steps (no sub-steps), `null` for parent steps
- `steps`: recursive sub-steps array

---

## Database Schema (PostgreSQL)

```sql
CREATE TABLE workflows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    metadata    JSONB,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
    total_steps INTEGER NOT NULL,
    status      TEXT NOT NULL
);

CREATE TABLE steps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    step_id         TEXT NOT NULL,
    parent_step_id  UUID REFERENCES steps(id) ON DELETE CASCADE,
    hierarchy_path  TEXT NOT NULL,        -- e.g. "/step-3/step-3-1"
    name            TEXT NOT NULL,
    status          TEXT NOT NULL,
    start_time      TIMESTAMPTZ,
    end_time        TIMESTAMPTZ,
    is_leaf         BOOLEAN NOT NULL,
    depth           INTEGER NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE step_dependencies (
    step_uuid       UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    depends_on_uuid UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    PRIMARY KEY (step_uuid, depends_on_uuid)
);

CREATE TABLE step_logs (
    step_uuid   UUID PRIMARY KEY REFERENCES steps(id) ON DELETE CASCADE,
    log_text    TEXT NOT NULL
);

CREATE INDEX idx_steps_workflow_parent ON steps(workflow_id, parent_step_id);
CREATE INDEX idx_steps_hierarchy_path ON steps(workflow_id, hierarchy_path);
```

`hierarchy_path` enables prefix queries for merged log views: `WHERE hierarchy_path LIKE '/step-3/%'`.

`step_logs` stores logs for leaf steps only (steps with `is_leaf = true`). Logs are stored as plain text. The table uses `step_uuid` as its primary key since each leaf step has exactly one log entry. CASCADE delete ensures logs are cleaned up when steps or workflows are removed.

Workflow expiry: daily cron or pg_cron runs `DELETE FROM workflows WHERE expires_at < now()`. Cascade deletes remove all steps and their logs.

---

## Log Query Strategy

Logs are queried via SQL joins on the `steps` and `step_logs` tables, using `hierarchy_path` for scoping:

- **All logs for a workflow**: Join `step_logs` with `steps` where `workflow_id = ?` and `is_leaf = true`, ordered by `sort_order`/`hierarchy_path`.
- **Logs for a specific leaf step**: Direct lookup by `step_uuid`.
- **Merged logs for a parent step and its descendants**: Join `step_logs` with `steps` where `hierarchy_path LIKE '/step-3/%'`, ordered by `sort_order`/`hierarchy_path`.

---

## API Design (Express Routes)

All routes served from the Express server at `:3001`.

| Method | Endpoint                                           | Purpose                                                       |
| ------ | -------------------------------------------------- | ------------------------------------------------------------- |
| POST   | `/api/workflows`                                   | Upload workflow JSON, returns `{ workflowId, viewUrl }`       |
| GET    | `/api/workflows/:id`                               | Workflow detail (name, metadata, status, timestamps)          |
| GET    | `/api/workflows/:id/steps?parentId=`               | Steps at hierarchy level with dependencies (cursor-paginated) |
| GET    | `/api/workflows/:id/steps/:uuid`                   | Step detail with breadcrumbs                                  |
| GET    | `/api/workflows/:id/logs?stepPath=&limit=&cursor=` | Merged logs for a step scope (cursor-paginated)               |

**Steps response shape:**

```json
{
  "steps": [
    {
      "uuid": "...",
      "stepId": "step-1",
      "name": "...",
      "status": "passed",
      "startTime": "...",
      "endTime": "...",
      "elapsedMs": 5000,
      "isLeaf": true,
      "childCount": 0
    }
  ],
  "dependencies": [{ "from": "step-1-uuid", "to": "step-2-uuid" }],
  "nextCursor": "..."
}
```

---

## Upload & Validation Pipeline

In `POST /api/workflows`:

1. **Size check** -- reject if body > 60 MB
2. **JSON schema validation** -- `ajv` validates structure and types
3. **Structural limits** -- walk tree: max 1M steps/level, max 100 deps/step, max 10 MB logs/leaf, max 50 MB total logs, max hierarchy depth 10.
4. **DAG validation** -- Depth First Search (DFS) at each hierarchy level to detect cycles
5. **DB insert** -- transaction: insert workflow, bulk-insert steps (batches of 1000), insert dependencies, bulk-insert logs for leaf steps
6. **Return** -- `201 { workflowId, viewUrl }` or `400 { error, message, details }`

---

## Frontend Architecture

**Tech stack:**

- Vite + React (TypeScript) -- SPA
- React Flow -- DAG visualization with virtualization
- dagre (@dagrejs/dagre) -- DAG layout algorithm
- Zustand -- lightweight state management
- @tanstack/react-virtual -- virtualized log rendering
- Tailwind CSS -- styling
- SWR or TanStack Query -- data fetching with caching

**Route structure (React Router):**

```
/                                      -- Upload landing page
/workflows/:workflowId                -- Top-level DAG view
/workflows/:workflowId/steps/:uuid    -- Sub-step DAG or leaf detail
```

**Key components:**

- `GraphView` -- React Flow canvas with dagre layout, StepNode custom nodes
- `StepNode` -- Status badge (color-coded), name, elapsed time; click navigates to sub-steps
- `LogPanel` -- Inline merged log view (virtual-scrolled)
- `Breadcrumbs` -- Hierarchy navigation from step detail API
- `UploadForm` -- File upload with drag-and-drop, validation error display
- `StatusBadge` -- Color-coded step status indicator
- `WorkflowHeader` -- Workflow name, metadata, overall status

**1M steps handling:** For levels > 10K steps, fall back to a filterable list/grid view grouped by status instead of dagre layout.

**State (Zustand):**

```typescript
interface WorkflowStore {
  currentWorkflow: Workflow | null;
  logPanelOpen: boolean;
  logFilter: string;
  graphLayout: "dagre" | "grid";
  statusFilter: StepStatus[];
}
```

---

## Directory Structure

```
/workflowui/
  docker-compose.yml
  PRD.md
  design.md

  /storage/                            # Infrastructure configs
    init.sql                           # PostgreSQL schema

  /ui/                                 # Vite + React SPA
    package.json
    vite.config.ts
    tsconfig.json
    index.html
    Dockerfile
    /src/
      main.tsx
      App.tsx
      /pages/                          # Upload, WorkflowView, StepView
      /components/                     # GraphView, StepNode, LogPanel, etc.
      /lib/                            # api.ts (fetch helpers), types.ts
      /store/                          # workflowStore.ts (Zustand)

  /ui/server/                          # Express API server
    package.json
    tsconfig.json
    Dockerfile
    /src/
      index.ts                         # Express app entry
      /routes/
        workflows.ts                   # Upload + workflow detail routes
        steps.ts                       # Step listing + detail routes
        logs.ts                        # Log proxy + Grafana redirect
      /lib/
        db.ts                          # PostgreSQL client (pg or Drizzle)
        validation.ts                  # JSON schema + DAG validation
        types.ts                       # Shared TypeScript types

  /tests/
    /data                              # E2E test data.
    e2e-test.ts                        # E2E test script using test JSON files from /tests/data

  /out/                                # gitignored, test/build outputs
```

---

## Docker Compose Services

| Service  | Image                       | Port | Purpose                    |
| -------- | --------------------------- | ---- | -------------------------- |
| ui       | Custom (Vite build + nginx) | 8080 | Serves React SPA           |
| api      | Custom (Express)            | 3001 | REST API server            |
| postgres | postgres:17-alpine          | 5432 | Workflow metadata and logs |

For dev, the Vite dev server proxies `/api` requests to the Express server.

---

## Implementation Phases

1. **Infrastructure** -- Docker Compose with PostgreSQL. Schema init script.
2. **Express API + Upload pipeline** -- Express scaffold, POST endpoint, JSON validation, DAG check, DB insert (metadata + logs).
3. **API endpoints** -- Workflow detail, steps-at-level with pagination, step detail with breadcrumbs, log proxy.
4. **Frontend shell** -- Vite + React scaffold, React Router, upload page, Zustand store.
5. **Graph view** -- React Flow + dagre, StepNode component, click-to-navigate.
6. **Log panel** -- Inline merged logs with virtual scroll.
7. **Polish** -- Breadcrumbs, error states, loading states, large-graph fallback view.
8. **Scripts & testing** -- Mock workflow generator, E2E tests.

---

## Verification

- `docker compose up` starts all services and they connect successfully
- Upload a mock workflow JSON via `POST /api/workflows` and verify the returned URL works
- Navigate the DAG: click steps, verify sub-step graphs render with correct dependencies
- Check merged log panel shows logs scoped to the current step and its descendants
- Upload invalid JSON (cycle, oversized, malformed) and verify appropriate error messages
- Run E2E test scripts using `bun run tests:e2e`

## Future Work

- Use drizzle in ui/server for postgres queries.
