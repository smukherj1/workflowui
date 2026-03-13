-- PostgreSQL schema initialization for workflowui
-- Applied automatically on first container start via Docker Compose

CREATE TABLE IF NOT EXISTS workflows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    metadata    JSONB,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
    total_steps INTEGER NOT NULL,
    status      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS steps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    step_id         TEXT NOT NULL,
    parent_step_id  UUID REFERENCES steps(id) ON DELETE CASCADE,
    hierarchy_path  TEXT NOT NULL,  -- e.g. "/step-3/step-3-1"
    name            TEXT NOT NULL,
    status          TEXT NOT NULL,
    start_time      TIMESTAMPTZ,
    end_time        TIMESTAMPTZ,
    is_leaf         BOOLEAN NOT NULL,
    depth           INTEGER NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS step_dependencies (
    step_uuid       UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    depends_on_uuid UUID NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    PRIMARY KEY (step_uuid, depends_on_uuid)
);

CREATE TABLE IF NOT EXISTS step_logs (
    step_uuid   UUID PRIMARY KEY REFERENCES steps(id) ON DELETE CASCADE,
    log_text    TEXT NOT NULL
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_steps_workflow_parent   ON steps(workflow_id, parent_step_id);
CREATE INDEX IF NOT EXISTS idx_steps_hierarchy_path    ON steps(workflow_id, hierarchy_path);
CREATE INDEX IF NOT EXISTS idx_workflows_expires_at    ON workflows(expires_at);
