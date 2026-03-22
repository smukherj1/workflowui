# Technical Design: CI/CD Workflow UI

## Context

The workflowui project needs a technical design to implement the PRD at `/PRD.md`. The system lets users upload a JSON execution trace of a CI/CD workflow, then visualize the step hierarchy as a DAG, inspect step metadata, and view merged/scoped logs. The design must handle up to 10,000 steps per hierarchy level and 50MB of logs per workflow with 7-day retention.

---

## Runtime

The project uses **Bun** as the JavaScript/TypeScript runtime for both the API server and frontend build tooling. Bun provides fast startup, built-in TypeScript support, and a compatible Node.js API surface.

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
              [Hono API :3001] --> [PostgreSQL :5432]  (workflow metadata, DAG, logs)
```

- **Vite + React**: SPA frontend for workflow visualization
- **Hono (TypeScript, Bun)**: REST API server with Zod-based request/response validation providing end-to-end type safety
- **Drizzle ORM**: Type-safe PostgreSQL queries and schema management
- **PostgreSQL**: Stores workflow metadata, step hierarchy, DAG relationships, and logs

---

## Standardized Metadata

Both workflows and steps share a common metadata structure. This provides a consistent way to describe what a workflow or step represents and when it ran:

| Field       | Required | Description                                                                                   |
| ----------- | -------- | --------------------------------------------------------------------------------------------- |
| `name`      | Yes      | Short human-readable description                                                              |
| `uri`       | No       | Unique identifier for the resource (e.g., `github://org/repo`, `gcs://bucket/path/to/object`) |
| `pin`       | No       | Version identifier for the resource (e.g., Git commit SHA, image digest)                      |
| `startTime` | No       | RFC 3339 UTC timestamp when execution started                                                 |
| `endTime`   | No       | RFC 3339 UTC timestamp when execution ended                                                   |

The UI displays only the metadata fields that are present — omitted fields are not shown.

---

## Workflow JSON Upload Schema

```json
{
  "workflow": {
    "metadata": {
      "name": "my-build-pipeline",
      "uri": "github://org/repo",
      "pin": "abc123def",
      "startTime": "2026-03-08T10:00:00Z",
      "endTime": "2026-03-08T10:05:00Z"
    },
    "steps": [
      {
        "id": "step-1",
        "metadata": {
          "name": "Start of the build",
          "uri": "gcs://artifacts/build-output",
          "pin": "sha256:abc123",
          "startTime": "2026-03-08T10:00:00Z",
          "endTime": "2026-03-08T10:00:05Z"
        },
        "status": "passed",
        "dependsOn": [],
        "logs": [
          { "timestamp": "2026-03-08T10:00:05Z", "content": "Initializing..." }
        ],
        "steps": []
      }
    ]
  }
}
```

- `metadata`: standardized metadata object (see above); `name` is required, all other fields optional
- `status`: `"passed"` | `"failed"` | `"running"` | `"skipped"` | `"cancelled"`
- `dependsOn`: references sibling step IDs only (same hierarchy level)
- `logs`: array of `LogEntry` objects for leaf steps (no sub-steps), `null` for parent steps. Each `LogEntry` has `content` (string, required) and `timestamp` (RFC 3339 string, optional).
- `steps`: recursive sub-steps array

---

## Database Schema, API Design & Upload Pipeline

See [`workflow-server/design.md`](workflow-server/design.md) for the full details on:

- PostgreSQL schema (tables, indexes, retention strategy)
- Drizzle ORM schema and migration strategy
- Log storage and query strategy
- API routes (Hono + Zod), request/response shapes
- Upload and validation pipeline

---

## Frontend Architecture

See [`ui/design.md`](ui/design.md) for the full details on:

- Component tree and specifications (GraphView, StepNode, InfoCard, LogsPage, Breadcrumbs, etc.)
- State management (Zustand store shape)
- Data fetching strategy (TanStack Query keys, caching)
- API client contract and TypeScript types
- Interaction flows (upload, landing page search, DAG navigation, dedicated log viewer, breadcrumbs)
- Large step count strategy (> 50 steps grid fallback with page-based pagination)
- Error and loading states
- Frontend E2E test plan

---

## Directory Structure

```
/workflowui/
  docker-compose.yml
  PRD.md
  design.md

  /ui/                                 # Vite + React SPA (see ui/design.md)
    design.md                          # Frontend technical design
    package.json
    vite.config.ts
    tsconfig.json
    index.html
    Dockerfile
    /src/                              # See ui/design.md for full source layout

  /workflow-server/                      # Hono API server (see workflow-server/design.md)
    design.md                          # API server technical design
    package.json
    tsconfig.json
    Dockerfile
    /src/
      index.ts                         # Hono app entry
      /routes/
        workflows.ts                   # Upload + workflow detail routes
        steps.ts                       # Step listing + detail routes
        logs.ts                        # Log query routes
      /lib/
        db.ts                          # Drizzle client, all queries
        schema.ts                      # Drizzle schema definitions
        validation.ts                  # Zod schemas + DAG validation
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
| api      | Custom (Hono + Bun)         | 3001 | REST API server            |
| postgres | postgres:17-alpine          | 5432 | Workflow metadata and logs |

For dev, the Vite dev server proxies `/api` requests to the Hono server.

---

## Verification

- Run backend E2E test scripts using `bun run test:e2e-backend`
- Run frontend E2E test scripts using `bun run test:e2e-frontend`

## Future Work

- Ability to search workflows and UI by name, URI, pin and date.
- Incrementally upload a workflow.
- Verify workflows are retained for up to 7 days.
- Add Github workflows to build docker images for the ui and server.
