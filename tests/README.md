# Tests

## E2E upload tests

`e2e-test.ts` posts each fixture to `POST /api/workflows` and asserts the expected HTTP status:

- Valid workflows → `201` with `workflowId` and `viewUrl` in the response body
- `invalid-cycle.json` → `400` with `error: STRUCTURAL_INVALID`

### Prerequisites

The API server and PostgreSQL must be running before the tests can execute. The quickest way is to start the infrastructure with Docker Compose and run the server locally:

```sh
# from repo root — start postgres and loki
docker compose up -d postgres loki

# in ui/server — start the API server
cd ui/server && npm run dev
```

Wait until you see `API server listening on :3001` before running the tests.

### Running the tests

From the repo root:

```sh
npm run test:e2e
```

Or directly:

```sh
npx ts-node tests/e2e-test.ts
```

Expected output:

```
Running E2E upload tests against http://localhost:3001

Health check: ok

  PASS [simple-linear.json]:     workflowId=...
  PASS [parallel-diamond.json]:  workflowId=...
  PASS [nested-hierarchy.json]:  workflowId=...
  PASS [mixed-status.json]:      workflowId=...
  PASS [invalid-cycle.json]:     error=STRUCTURAL_INVALID details="Cycle detected..."

Results: 5 passed, 0 failed
```

### Targeting a different server

Set `API_URL` to point the tests at a different host:

```sh
API_URL=http://localhost:3001 npm run test:e2e
```
