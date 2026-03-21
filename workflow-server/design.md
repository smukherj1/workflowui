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

The Drizzle schema in `src/lib/schema.ts` mirrors the SQL above using Drizzle's PostgreSQL column builders (`pgTable`, `uuid`, `text`, `timestamp`, `integer`, `boolean`). Relations are defined
for join queries and to cascade deletes when a workflow is deleted.

Drizzle provides:

- **Type-safe queries**: All `select`, `insert`, `update`, and `delete` operations are fully typed based on the schema definition.
- **Schema migrations**: `drizzle-kit` generates SQL migrations from schema changes (`bun run drizzle-kit generate` and `bun run drizzle-kit migrate`).
- **Query builder**: Complex queries (joins, subqueries, aggregations) use Drizzle's SQL-like builder API rather than raw strings.

The Drizzle client is initialized in `src/lib/db.ts` using `drizzle(pool)` with the `node-postgres` driver adapter.

---

## Log Storage & Query Strategy

Logs are inserted into `step_logs` within the same transaction as the workflow upload — no separate push step. Each leaf step's full log string is stored as a single `log_text` row.

**Query pattern** (`GET /api/workflows/:id/logs?stepPath=`):

```sql
SELECT s.step_id, s.hierarchy_path, s.depth, sl.log_text
FROM steps s
JOIN step_logs sl ON sl.step_uuid = s.id
WHERE s.workflow_id = $1
  AND s.is_leaf = true
  AND (s.hierarchy_path = $2 OR s.hierarchy_path LIKE $3)
ORDER BY s.sort_order
```

Where `$2` is the exact `stepPath` and `$3` is `stepPath + '/%'`. This covers both leaf lookup (exact match) and merged parent view (prefix match).

Results are split into individual lines in the application layer and returned with cursor-based pagination (line offset encoded as base64url).

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

This replaces the previous AJV-based validation, providing compile-time type inference for all validated inputs.

---

## API Routes

All routes are served on `:3001`.

| Method | Endpoint                                           | Handler file          | Purpose                                                       |
| ------ | -------------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| POST   | `/api/workflows`                                   | `routes/workflows.ts` | Upload workflow JSON, returns `{ workflowId, viewUrl }`       |
| GET    | `/api/workflows/:id`                               | `routes/workflows.ts` | Workflow detail (metadata, status, timestamps)                |
| DELETE | `/api/workflows/:id`                               | `routes/workflows.ts` | Delete workflow and all associated steps/logs (204/404)       |
| GET    | `/api/workflows/:id/steps?parentId=`               | `routes/steps.ts`     | Steps at hierarchy level with dependencies (cursor-paginated) |
| GET    | `/api/workflows/:id/steps/:uuid`                   | `routes/steps.ts`     | Step detail with breadcrumbs                                  |
| GET    | `/api/steps/:uuid`                                 | `routes/steps.ts`     | Step lookup by UUID (returns workflow ID and step detail)     |
| GET    | `/api/workflows/:id/logs?stepPath=&limit=&cursor=` | `routes/logs.ts`      | Merged logs for a step scope (cursor-paginated)               |

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
  "dependencies": [{ "from": "step-1-uuid", "to": "step-2-uuid" }],
  "nextCursor": "..."
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
      "timestampNs": "0",
      "line": "Building React app...",
      "stepPath": "/ci/build-frontend",
      "stepId": "build-frontend",
      "depth": "2"
    }
  ],
  "nextCursor": "..."
}
```

Cursor for steps is `base64url(sort_order)`. Cursor for logs is `base64url(line_offset)`.

---

## Upload & Validation Pipeline

`POST /api/workflows` processes uploads in this order:

1. **Size check** — reject if `Content-Length` > 60 MB
2. **Zod schema validation** — validates structure, field types, and metadata shape
3. **Structural limits** — walk tree: max 1M steps/level, max 100 deps/step, max 10 MB logs/leaf, max 50 MB total logs, max hierarchy depth 10
4. **DAG validation** — DFS at each hierarchy level to detect cycles in `dependsOn` references
5. **DB insert** — single Drizzle transaction: insert workflow row, bulk-insert steps (batches of 1000), bulk-insert dependencies, bulk-insert leaf logs
6. **Return** — `201 { workflowId, viewUrl }` or `400 { error, details }`

---

## Source Layout

```
workflow-server/
  src/
    index.ts              # Hono app entry, port config, route mounting
    routes/
      workflows.ts        # POST /api/workflows, GET /api/workflows/:id
      steps.ts            # GET steps at level, GET step detail + breadcrumbs
      logs.ts             # GET logs (DB query, cursor-paginated)
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
