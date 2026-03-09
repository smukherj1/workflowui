# Technical Design: CI/CD Workflow UI

## Context

The workflowui project needs a technical design to implement the PRD at `/PRD.md`. The system lets users upload a JSON execution trace of a CI/CD workflow, then visualize the step hierarchy as a DAG, inspect step metadata, and view merged/scoped logs. The design must handle up to 1M steps per hierarchy level and 50MB of logs per workflow with 7-day retention.

---

## Log Storage: Grafana Loki + Grafana

| Criteria              | ELK                        | Loki + Grafana                    |
| --------------------- | -------------------------- | --------------------------------- |
| RAM baseline          | 8-16 GB                    | 2-4 GB                            |
| Deployment complexity | High (3 services)          | Low (simple config)               |
| Query model           | Full-text index (overkill) | Label-based (perfect fit)         |
| Retention config      | Index lifecycle mgmt       | Single `retention_period` setting |

Access patterns are simple label-based lookups (logs for workflow X, step Y). Loki's label model maps directly to workflow/step hierarchy. Grafana provides log viewing with filtering/aggregation and can be embedded via iframe or linked with pre-filled LogQL queries.

---

## System Architecture

```
[Browser] --> [Vite React SPA :5173]
                  |
                  v
              [Express API :3001] --> [PostgreSQL :5432]  (workflow metadata, DAG)
                  |                --> [Loki :3100]        (log storage)
                  |
[Browser] --> [Grafana :3000]                             (log viewing UI)
```

- **Vite + React**: SPA frontend for workflow visualization
- **Express (TypeScript)**: REST API server handling uploads, validation, queries
- **PostgreSQL**: Stores workflow metadata, step hierarchy, DAG relationships
- **Grafana Loki**: Stores step logs with label-based indexing
- **Grafana**: Log exploration UI (linked or embedded via iframe)

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

CREATE INDEX idx_steps_workflow_parent ON steps(workflow_id, parent_step_id);
CREATE INDEX idx_steps_hierarchy_path ON steps(workflow_id, hierarchy_path);
```

`hierarchy_path` enables prefix queries for merged log views: `WHERE hierarchy_path LIKE '/step-3/%'`.

Workflow expiry: daily cron or pg_cron runs `DELETE FROM workflows WHERE expires_at < now()`. Cascade deletes remove all steps. Loki handles its own 7-day retention via `retention_period: 168h`.

---

## Loki Label Strategy

To avoid high cardinality (1M steps = 1M streams), use one stream per workflow with structured metadata (Loki 3.0+):

- **Indexed label**: `{workflow_id="<uuid>"}`
- **Structured metadata**: `step_path`, `step_id`, `depth`

Query examples:

- All logs: `{workflow_id="abc"}`
- Specific step: `{workflow_id="abc"} | step_path="/step-3/step-3-1"`
- Merged sub-steps: `{workflow_id="abc"} | step_path=~"/step-3/.*"`

---

## API Design (Express Routes)

All routes served from the Express server at `:3001`.

| Method | Endpoint                                           | Purpose                                                       |
| ------ | -------------------------------------------------- | ------------------------------------------------------------- |
| POST   | `/api/workflows`                                   | Upload workflow JSON, returns `{ workflowId, viewUrl }`       |
| GET    | `/api/workflows/:id`                               | Workflow detail (name, metadata, status, timestamps)          |
| GET    | `/api/workflows/:id/steps?parentId=`               | Steps at hierarchy level with dependencies (cursor-paginated) |
| GET    | `/api/workflows/:id/steps/:uuid`                   | Step detail with breadcrumbs                                  |
| GET    | `/api/workflows/:id/logs?stepPath=&limit=&cursor=` | Proxied Loki log query for inline log panel                   |
| GET    | `/api/workflows/:id/steps/:uuid/logs/explore`      | 302 redirect to Grafana with pre-filled LogQL                 |

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
5. **DB insert** -- transaction: insert workflow, bulk-insert steps (batches of 1000), insert dependencies
6. **Loki push** -- batch log lines into 2-4 MB chunks via `POST /loki/api/v1/push`
7. **Return** -- `201 { workflowId, viewUrl }` or `400 { error, message, details }`

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
- `LogPanel` -- Inline merged log view (virtual-scrolled) + "Open in Grafana" button
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
    loki-config.yaml
    grafana-datasources.yaml
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
        loki.ts                        # Loki push/query client
        grafana.ts                     # Grafana URL builder
        validation.ts                  # JSON schema + DAG validation
        types.ts                       # Shared TypeScript types

  /tests/
    /data                              # E2E test data.
    generate-mock-workflow.ts          # Generate test JSON files in /tests/data.
    e2e-test.ts                        # E2E test script using test JSON files from /tests/data

  /out/                                # gitignored, test/build outputs
```

---

## Docker Compose Services

| Service  | Image                       | Port | Purpose           |
| -------- | --------------------------- | ---- | ----------------- |
| ui       | Custom (Vite build + nginx) | 8080 | Serves React SPA  |
| api      | Custom (Express)            | 3001 | REST API server   |
| postgres | postgres:17-alpine          | 5432 | Workflow metadata |
| loki     | grafana/loki:3.0.0          | 3100 | Log storage       |
| grafana  | grafana/grafana:11.0.0      | 3000 | Log viewer        |

Grafana configured with anonymous access + `allow_embedding: true` for iframe support. For dev, the Vite dev server proxies `/api` requests to the Express server.

---

## Implementation Phases

1. **Infrastructure** -- Docker Compose with PostgreSQL, Loki, Grafana. Schema init script. Verify Loki push/query works.
2. **Express API + Upload pipeline** -- Express scaffold, POST endpoint, JSON validation, DAG check, DB insert, Loki push.
3. **API endpoints** -- Workflow detail, steps-at-level with pagination, step detail with breadcrumbs, log proxy.
4. **Frontend shell** -- Vite + React scaffold, React Router, upload page, Zustand store.
5. **Graph view** -- React Flow + dagre, StepNode component, click-to-navigate.
6. **Log panel** -- Inline merged logs with virtual scroll, Grafana redirect links.
7. **Polish** -- Breadcrumbs, error states, loading states, large-graph fallback view.
8. **Scripts & testing** -- Mock workflow generator, E2E tests.

---

## Verification

- `docker compose up` starts all services and they connect successfully
- Upload a mock workflow JSON via `POST /api/workflows` and verify the returned URL works
- Navigate the DAG: click steps, verify sub-step graphs render with correct dependencies
- Check merged log panel shows logs scoped to the current step and its descendants
- Click "Open in Grafana" and verify LogQL query is pre-filled for the correct step scope
- Upload invalid JSON (cycle, oversized, malformed) and verify appropriate error messages
- Run mock workflow generator from `/scripts/` and verify generated files upload successfully
- Run E2E test scripts from `/scripts/`
