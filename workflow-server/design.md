# Technical Design: Hono API Server (`workflow-server`)

## Overview

The Hono API server handles workflow uploads, validation, and all read queries. It is the sole writer to PostgreSQL and the sole source of truth for workflow data. See the top-level `design.md` for system context, architecture decisions, and the upload JSON schema.

The server runs on **Bun** and uses **Hono** for HTTP routing with **Zod** for request/response validation, providing end-to-end type safety. Database access uses **Drizzle ORM** for type-safe queries and schema management.

---

## Database Schema (PostgreSQL)

The schema is defined using Drizzle ORM in `src/lib/schema.ts` and managed via Drizzle migrations.

TODO: Workflow expiry: a daily cron or pg_cron runs `DELETE FROM workflows WHERE expires_at < now()`. Cascade deletes remove all steps and logs.

---

## Drizzle ORM

The Drizzle schema in `src/lib/schema.ts` mirrors the SQL above using Drizzle's PostgreSQL column builders (`pgTable`, `uuid`, `text`, `timestamp`, `integer`, `boolean`). Cascade deletes are wired directly from `workflows.id` to each child table (`steps`, `step_dependencies`, `step_logs`) so deleting a workflow triggers three parallel bulk deletes instead of a per-row cascade chain.

Drizzle provides:

- **Type-safe queries**: All `select`, `insert`, `update`, and `delete` operations are fully typed based on the schema definition.
- **Schema management**: `bunx drizzle-kit push` applies schema changes directly to the database in development.
- **Query builder**: Complex queries (joins, subqueries, aggregations) use Drizzle's SQL-like builder API rather than raw strings.

The Drizzle client is initialized in `src/lib/db.ts` using `drizzle(pool)` with the `node-postgres` driver adapter.

---

## Log Storage & Query Strategy

Logs are inserted into `step_logs` within the same transaction as the workflow upload — no separate push step. Each log entry is stored as one row with `line_number`, `content`, and optional `timestamp`.

**Query pattern** (`GET /api/workflows/:id/logs?stepPath=`):

```sql
SELECT sl.content, sl.timestamp, s.step_id, s.hierarchy_path, s.depth, sl.line_number
FROM step_logs sl
JOIN steps s ON s.id = sl.step_uuid
WHERE s.workflow_id = $1
  AND s.is_leaf = true
  AND (s.hierarchy_path = $2 OR s.hierarchy_path LIKE $3)
ORDER BY s.sort_order, sl.line_number
```

Where `$2` is the exact `stepPath` and `$3` is `stepPath + '/%'`. This covers both leaf lookup (exact match) and merged parent view (prefix match).

Results are returned directly from DB rows with cursor-based pagination (row offset encoded as base64url).

---

## Hono + Zod Request Validation

Each route defines Zod schemas for path parameters, query parameters, and request bodies. Hono's `zValidator` middleware validates requests before the handler runs, returning structured 400 errors on validation failure.

Example pattern:

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono();

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  parentId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(1000),
});

app.get(
  "/api/workflows/:id/steps",
  zValidator("param", paramsSchema),
  zValidator("query", querySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { parentId, cursor, limit } = c.req.valid("query");
    // ... handler logic
  },
);
```

---

## API Routes

All routes are served on `:3001`.

| Method | Endpoint                                                                   | Handler file          | Purpose                                                          |
| ------ | -------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| POST   | `/api/workflows`                                                           | `routes/workflows.ts` | Upload workflow JSON, returns `{ workflowId, viewUrl }`          |
| GET    | `/api/workflows/:id`                                                       | `routes/workflows.ts` | Workflow detail (metadata, status, timestamps)                   |
| DELETE | `/api/workflows/:id`                                                       | `routes/workflows.ts` | Delete workflow and all associated steps/logs (204/404)          |
| GET    | `/api/workflows/:id/breadcrumbs?stepPath=`                                 | `routes/workflows.ts` | Breadcrumb chain for a given step path within a workflow         |
| GET    | `/api/workflows/:id/steps?parentId=`                                       | `routes/steps.ts`     | All steps at hierarchy level with dependencies (single response) |
| GET    | `/api/workflows/:id/steps/:uuid`                                           | `routes/steps.ts`     | Step detail with breadcrumbs                                     |
| GET    | `/api/steps/:uuid`                                                         | `routes/steps.ts`     | Step lookup by UUID (returns workflow ID and step detail)        |
| GET    | `/api/workflows/:id/logs?stepPath=&limit=&cursor=`                         | `routes/logs.ts`      | Merged logs for a step scope (cursor-paginated)                  |
| GET    | `/api/search?q=&name=&uri=&pin=&path=&scope=&workflowId=&from=&to=&limit=` | `routes/search.ts`    | Search workflows and steps by name, URI, pin, or path            |

**Workflow detail response shape:**

```json
{
  "id": "...",
  "name": "my-build-pipeline",
  "uri": "github://org/repo",
  "pin": "abc123def",
  "startTime": "2026-03-08T10:00:00Z",
  "endTime": "2026-03-08T10:05:00Z",
  "status": "passed",
  "totalSteps": 42,
  "uploadedAt": "2026-03-10T12:00:00Z",
  "expiresAt": "2026-03-17T12:00:00Z"
}
```

**Steps response shape:**

```json
{
  "steps": [
    {
      "uuid": "...",
      "stepId": "step-1",
      "name": "...",
      "uri": "gcs://artifacts/build-output",
      "pin": "sha256:abc123",
      "status": "passed",
      "startTime": "...",
      "endTime": "...",
      "isLeaf": true,
      "childCount": 0
    }
  ],
  "dependencies": [{ "from": "step-1-uuid", "to": "step-2-uuid" }]
}
```

**Step detail response shape** (`GET /api/workflows/:id/steps/:uuid`):

```json
{
  "step": {
    "uuid": "...",
    "stepId": "step-1",
    "name": "...",
    "uri": "...",
    "pin": "...",
    "status": "passed",
    "startTime": "...",
    "endTime": "...",
    "isLeaf": false,
    "hierarchyPath": "/step-1",
    "depth": 1
  },
  "breadcrumbs": [{ "uuid": "...", "name": "..." }]
}
```

**Step lookup response shape** (`GET /api/steps/:uuid`):

Returns the same step detail as above, plus the `workflowId` so the frontend can construct the full URL without knowing the workflow in advance. Returns 404 if the step UUID does not exist or belongs to an expired workflow.

```json
{
  "workflowId": "...",
  "step": {
    "uuid": "...",
    "stepId": "step-1",
    "name": "...",
    "uri": "...",
    "pin": "...",
    "status": "passed",
    "startTime": "...",
    "endTime": "...",
    "isLeaf": false,
    "hierarchyPath": "/step-1",
    "depth": 1
  },
  "breadcrumbs": [{ "uuid": "...", "name": "..." }]
}
```

**Logs response shape:**

```json
{
  "lines": [
    {
      "content": "Building React app...",
      "timestamp": "2026-03-08T10:00:01Z",
      "stepPath": "/ci/build-frontend",
      "stepId": "build-frontend",
      "depth": "2"
    }
  ],
  "nextCursor": "..."
}
```

Cursor for logs is `base64url(row_offset)`.

**Breadcrumbs response shape** (`GET /api/workflows/:id/breadcrumbs?stepPath=`):

```json
{
  "breadcrumbs": [
    { "uuid": "...", "name": "CI", "hierarchyPath": "/ci" },
    {
      "uuid": "...",
      "name": "Build Frontend",
      "hierarchyPath": "/ci/build-frontend"
    }
  ]
}
```

Walks each path segment of `stepPath` and looks up the corresponding step row. Returns an empty array if the path is unknown. Used by `LogsPage` to render breadcrumb navigation.

**Search response shape** (`GET /api/search`):

| Parameter    | Required | Description                                                            |
| ------------ | -------- | ---------------------------------------------------------------------- |
| `q`          | No\*     | General search term — searches name, URI, and pin fields (ILIKE)       |
| `name`       | No\*     | Search term restricted to the name field (ILIKE)                       |
| `uri`        | No\*     | Search term restricted to the URI field (ILIKE)                        |
| `pin`        | No\*     | Search term restricted to the pin field (ILIKE)                        |
| `path`       | No\*     | Search term restricted to the hierarchy path field (ILIKE, steps only) |
| `scope`      | No       | `"workflows"`, `"steps"`, or `"all"` (default `"all"`)                 |
| `workflowId` | No       | Scope step search to a specific workflow                               |
| `from`       | No       | Filter by `startTime >= RFC 3339 timestamp`                            |
| `to`         | No       | Filter by `startTime <= RFC 3339 timestamp`                            |
| `limit`      | No       | Max results (default 20, max 100)                                      |

\* At least one of `q`, `name`, `uri`, `pin`, `path` must be provided. All provided parameters are ANDed together. If `path` is the only filter and `scope=workflows`, no workflow results are returned (path is step-only).

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

Search uses `ILIKE` for case-insensitive substring matching. No special indexes are needed given the 7-day retention window and modest data volume.

---

## Upload & Validation Pipeline

`POST /api/workflows` processes uploads in this order:

1. **Zod schema validation** — validates structure, field types, and metadata shape
2. **Structural limits** — walk tree: max 10,000 steps/level, max 100 deps/step, max 10 MB logs/leaf, max 50 MB total logs, max hierarchy depth 10
3. **DAG validation** — DFS at each hierarchy level to detect cycles in `dependsOn` references
4. **DB insert** — single transaction: insert workflow row; bulk-insert steps in two passes (pass 1: `unnest()` batches of 1000 to get UUIDs; pass 2: batch `UPDATE` to set `parent_step_id`); bulk-insert dependencies and logs via `unnest()` batches of 1000 (each row includes `workflow_id` for direct cascade)
5. **Return** — `201 { workflowId, viewUrl }` or `400 { error, details }`

---

## Source Layout

```
workflow-server/
  src/
    index.ts              # Hono app entry, port config, route mounting
    routes/
      workflows.ts        # POST /api/workflows, GET /api/workflows/:id, GET breadcrumbs
      steps.ts            # GET steps at level, GET step detail + breadcrumbs
      logs.ts             # GET logs (DB query, cursor-paginated)
      search.ts           # GET /api/search (workflows and steps)
    lib/
      db.ts               # Drizzle client, all query functions
      schema.ts           # Drizzle table/relation definitions
      validation.ts       # Zod schemas + structural + DAG validation
      types.ts            # Shared TypeScript types (WorkflowInput, FlatStep, etc.)
  drizzle.config.ts       # Drizzle Kit configuration
  package.json
  tsconfig.json
  Dockerfile
```

---

## Dependencies

| Package               | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `hono`                | HTTP framework with type-safe routing            |
| `@hono/zod-validator` | Zod middleware for Hono request validation       |
| `zod`                 | Schema declaration and validation                |
| `drizzle-orm`         | Type-safe ORM for PostgreSQL                     |
| `drizzle-kit`         | Schema migration tooling (dev dependency)        |
| `pg`                  | PostgreSQL client (used by Drizzle's pg adapter) |

---

## Environment Variables

| Variable     | Default      | Description       |
| ------------ | ------------ | ----------------- |
| `PORT`       | `3001`       | HTTP listen port  |
| `PGHOST`     | `localhost`  | PostgreSQL host   |
| `PGPORT`     | `5432`       | PostgreSQL port   |
| `PGDATABASE` | `workflowui` | Database name     |
| `PGUSER`     | `workflowui` | Database user     |
| `PGPASSWORD` | `workflowui` | Database password |
