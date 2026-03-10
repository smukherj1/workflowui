# Database Schema Updates

## Overview

The PostgreSQL schema is initialized from `storage/init.sql` when the `postgres` container first starts. Docker only runs init scripts against an **empty data volume**, so `init.sql` is a one-time bootstrap — it is not re-applied on subsequent container restarts.

Schema changes after the initial deploy must be applied as incremental migration scripts.

---

## How to Apply a Schema Change

### 1. Write a migration script

Create a numbered SQL file in `storage/migrations/`:

```
storage/migrations/0001_add_step_labels.sql
storage/migrations/0002_add_workflow_tags.sql
```

Name files with a zero-padded sequence number so they sort and apply in order.

A migration file should be idempotent where possible (use `IF NOT EXISTS`, `IF EXISTS`, etc.):

```sql
-- 0001_add_step_labels.sql
ALTER TABLE steps ADD COLUMN IF NOT EXISTS labels JSONB;
CREATE INDEX IF NOT EXISTS idx_steps_labels ON steps USING GIN (labels);
```

### 2. Apply the migration

Connect to the running Postgres container and run the script:

```bash
docker compose exec postgres psql -U workflowui -d workflowui -f /dev/stdin < storage/migrations/0001_add_step_labels.sql
```

Or copy the file in first if you prefer:

```bash
docker compose cp storage/migrations/0001_add_step_labels.sql postgres:/tmp/migration.sql
docker compose exec postgres psql -U workflowui -d workflowui -f /tmp/migration.sql
```

### 3. Update `init.sql`

After verifying the migration works, fold the change into `storage/init.sql` so fresh environments initialize correctly. Keep `init.sql` as the canonical description of the full schema.

---

## Tracking Applied Migrations

For a lightweight audit trail, keep a `storage/migrations/APPLIED.md` log:

```
0001_add_step_labels.sql   — applied 2026-03-10 by alice
0002_add_workflow_tags.sql — applied 2026-03-15 by bob
```

If the project grows to need automated migration management, consider adopting [golang-migrate](https://github.com/golang-migrate/migrate) or [Flyway](https://flywaydb.org/), both of which support PostgreSQL and can be wired into the Docker Compose startup.

---

## Resetting to a Clean State (Dev Only)

To wipe all data and re-run `init.sql` from scratch:

```bash
docker compose down -v          # removes named volumes including postgres_data
docker compose up -d postgres   # fresh container re-runs init.sql
```

**Do not do this in production** — it destroys all workflow data.