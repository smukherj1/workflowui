# workflowui API server

Express + TypeScript REST API. Handles workflow JSON uploads, stores metadata in PostgreSQL, and pushes logs to Loki.

## Structure

```
ui/server/
├── src/
│   ├── index.ts              # Express app entry point
│   ├── routes/
│   │   └── workflows.ts      # POST /api/workflows
│   └── lib/
│       ├── types.ts          # Shared TypeScript types
│       ├── validation.ts     # AJV schema + structural validation (cycles, limits)
│       ├── db.ts             # PostgreSQL client and bulk insert logic
│       └── loki.ts           # Loki log push client
├── package.json
├── tsconfig.json
└── Dockerfile
```

## Prerequisites

The server requires PostgreSQL and Loki to be running. Start them with Docker Compose from the repo root:

```sh
docker compose up -d postgres loki
```

Wait for postgres to pass its health check before starting the server:

```sh
docker compose ps   # postgres should show "(healthy)"
```

## Local development

Install dependencies:

```sh
cd ui/server
npm install
```

Start the dev server (auto-restarts on file changes):

```sh
npm run dev
```

The server listens on `http://localhost:3001` by default.

### Environment variables

All have defaults that match the Docker Compose service names and credentials:

| Variable      | Default          | Description              |
| ------------- | ---------------- | ------------------------ |
| `PORT`        | `3001`           | HTTP listen port         |
| `PGHOST`      | `localhost`      | PostgreSQL host          |
| `PGPORT`      | `5432`           | PostgreSQL port          |
| `PGDATABASE`  | `workflowui`     | Database name            |
| `PGUSER`      | `workflowui`     | Database user            |
| `PGPASSWORD`  | `workflowui`     | Database password        |
| `LOKI_URL`    | `http://localhost:3100` | Loki base URL   |

Override any of them inline:

```sh
PGHOST=myhost npm run dev
```

## API

### `GET /health`

Returns `{ "status": "ok" }`. Use this to confirm the server is up.

### `POST /api/workflows`

Upload a workflow JSON. Returns `201 { workflowId, viewUrl }` on success, or `400 { error, details }` on validation failure.

**Request body** (Content-Type: application/json, max 60 MB):

```json
{
  "workflow": {
    "name": "my-pipeline",
    "metadata": { "repository": "org/repo", "branch": "main", "commit": "abc123" },
    "steps": [
      {
        "id": "step-1",
        "name": "Build",
        "status": "passed",
        "startTime": "2026-03-08T10:00:00Z",
        "endTime": "2026-03-08T10:00:30Z",
        "dependsOn": [],
        "logs": "Building...\nDone.\n",
        "steps": []
      }
    ]
  }
}
```

**Validation rules:**
- `status` must be one of `passed`, `failed`, `running`, `skipped`, `cancelled`
- `dependsOn` may only reference sibling step IDs (same hierarchy level)
- No dependency cycles at any hierarchy level
- Max 1M steps per hierarchy level, max depth 10, max 100 deps per step
- Leaf step logs ≤ 10 MB each, total logs ≤ 50 MB per workflow

## Building for Docker

```sh
npm run build          # compiles TypeScript to dist/
docker build -t workflowui-api .
```

Or let Docker Compose build it:

```sh
docker compose up -d api
```
