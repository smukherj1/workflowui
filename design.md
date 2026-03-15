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

## Database Schema, API Design & Upload Pipeline

See [`ui/server/design.md`](ui/server/design.md) for the full details on:

- PostgreSQL schema (tables, indexes, retention strategy)
- Log storage and query strategy
- API routes, request/response shapes
- Upload and validation pipeline

---

## Frontend Architecture

See [`ui/design.md`](ui/design.md) for the full details on:

- Component tree and specifications (GraphView, StepNode, LogPanel, Breadcrumbs, etc.)
- State management (Zustand store shape)
- Data fetching strategy (TanStack Query keys, caching)
- API client contract and TypeScript types
- Interaction flows (upload, DAG navigation, log panel, breadcrumbs)
- Large step count strategy (> 10K steps grid fallback)
- Error and loading states
- Frontend E2E test plan

---

## Directory Structure

```
/workflowui/
  docker-compose.yml
  PRD.md
  design.md

  /storage/                            # Infrastructure configs
    init.sql                           # PostgreSQL schema

  /ui/                                 # Vite + React SPA (see ui/design.md)
    design.md                          # Frontend technical design
    package.json
    vite.config.ts
    tsconfig.json
    index.html
    Dockerfile
    /src/                              # See ui/design.md for full source layout

  /ui/server/                          # Express API server (see ui/server/design.md)
    design.md                          # API server technical design
    package.json
    tsconfig.json
    Dockerfile
    /src/
      index.ts                         # Express app entry
      /routes/
        workflows.ts                   # Upload + workflow detail routes
        steps.ts                       # Step listing + detail routes
        logs.ts                        # Log query routes
      /lib/
        db.ts                          # PostgreSQL client, all queries
        validation.ts                  # JSON schema + DAG validation
        types.ts                       # Shared TypeScript types

  /tests/
    /data                              # E2E test data.
    e2e-tests-backend.ts               # Backend API E2E tests
    e2e-tests-frontend.ts              # Frontend E2E tests (SPA serving, data contracts)

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

## Verification

- Run backend E2E test scripts using `bun run test:e2e-backend`
- Run frontend E2E test scripts using `bun run test:e2e-frontend`

## Known Issues

### UI

- No way in UI to view merged logs for a step that has sub-steps.

## Future Work

- Verify workflows are retained for up to 7 days.
- Add navigation bar in workflow / step view to navigate to workflow upload, search page, etc.
- Update landing page to also allow searching for uploaded workflows and going to workflow by ID.
- Add Github workflows to build docker images for the ui and server.
- Add a delete workflow API that tests can use to delete the uploaded workflow after they complete.
- Use drizzle in ui/server for type safe postgres queries.
- Replace express JS with Hono for backend API Server for typesafe requests & responses.
