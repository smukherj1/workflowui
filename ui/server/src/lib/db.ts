import { Pool, PoolClient } from "pg";
import { randomUUID } from "crypto";
import type {
  WorkflowInput,
  WorkflowStep,
  FlatStep,
  PendingDep,
} from "./types";

export interface LogLine {
  timestampNs: string;
  line: string;
  stepPath: string;
  stepId: string;
  depth: string;
}

interface PendingLog {
  stepUUID: string;
  logText: string;
}

export const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: parseInt(process.env.PGPORT ?? "5432"),
  database: process.env.PGDATABASE ?? "workflowui",
  user: process.env.PGUSER ?? "workflowui",
  password: process.env.PGPASSWORD ?? "workflowui",
});

function deriveWorkflowStatus(input: WorkflowInput): string {
  const statuses = new Set<string>();
  function walk(steps: WorkflowStep[]) {
    for (const s of steps) {
      statuses.add(s.status);
      walk(s.steps);
    }
  }
  walk(input.workflow.steps);
  if (statuses.has("failed")) return "failed";
  if (statuses.has("running")) return "running";
  if (statuses.has("cancelled")) return "cancelled";
  return "passed";
}

function flattenSteps(
  steps: WorkflowStep[],
  parentUUID: string | null,
  parentPath: string,
  depth: number,
  flatSteps: FlatStep[],
  pendingDeps: PendingDep[],
  pendingLogs: PendingLog[],
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const uuid = randomUUID();
    const hierarchyPath = `${parentPath}/${step.id}`;
    const isLeaf = step.steps.length === 0;
    const parentKey = parentUUID ?? "root";

    flatSteps.push({
      uuid,
      stepId: step.id,
      parentUUID,
      hierarchyPath,
      name: step.name,
      status: step.status,
      startTime: step.startTime ? new Date(step.startTime) : null,
      endTime: step.endTime ? new Date(step.endTime) : null,
      isLeaf,
      depth,
      sortOrder: i,
    });

    for (const depId of step.dependsOn) {
      pendingDeps.push({ stepUUID: uuid, parentKey, dependsOnStepId: depId });
    }

    if (isLeaf) {
      if (step.logs) {
        pendingLogs.push({ stepUUID: uuid, logText: step.logs });
      }
    } else {
      flattenSteps(
        step.steps,
        uuid,
        hierarchyPath,
        depth + 1,
        flatSteps,
        pendingDeps,
        pendingLogs,
      );
    }
  }
}

async function bulkInsertLogs(
  client: PoolClient,
  logs: PendingLog[],
): Promise<void> {
  if (logs.length === 0) return;
  const BATCH = 1000;
  for (let i = 0; i < logs.length; i += BATCH) {
    const slice = logs.slice(i, i + BATCH);
    const placeholders = slice.map(
      (_, idx) => `($${idx * 2 + 1},$${idx * 2 + 2})`,
    );
    const values = slice.flatMap((l) => [l.stepUUID, l.logText]);
    await client.query(
      `INSERT INTO step_logs (step_uuid, log_text) VALUES ${placeholders.join(",")}`,
      values,
    );
  }
}

async function bulkInsertSteps(
  client: PoolClient,
  workflowId: string,
  batch: FlatStep[],
): Promise<void> {
  const COLS = 12;
  const placeholders: string[] = [];
  const values: unknown[] = [];

  batch.forEach((s, idx) => {
    const o = idx * COLS;
    placeholders.push(
      `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12})`,
    );
    values.push(
      s.uuid,
      workflowId,
      s.stepId,
      s.parentUUID,
      s.hierarchyPath,
      s.name,
      s.status,
      s.startTime,
      s.endTime,
      s.isLeaf,
      s.depth,
      s.sortOrder,
    );
  });

  await client.query(
    `INSERT INTO steps
       (id, workflow_id, step_id, parent_step_id, hierarchy_path, name, status,
        start_time, end_time, is_leaf, depth, sort_order)
     VALUES ${placeholders.join(",")}`,
    values,
  );
}

async function bulkInsertDeps(
  client: PoolClient,
  deps: { stepUUID: string; dependsOnUUID: string }[],
): Promise<void> {
  if (deps.length === 0) return;
  const BATCH = 1000;
  for (let i = 0; i < deps.length; i += BATCH) {
    const slice = deps.slice(i, i + BATCH);
    const placeholders = slice.map(
      (_, idx) => `($${idx * 2 + 1},$${idx * 2 + 2})`,
    );
    const values = slice.flatMap((d) => [d.stepUUID, d.dependsOnUUID]);
    await client.query(
      `INSERT INTO step_dependencies (step_uuid, depends_on_uuid) VALUES ${placeholders.join(",")}`,
      values,
    );
  }
}

export async function insertWorkflow(input: WorkflowInput): Promise<string> {
  const workflowId = randomUUID();
  const status = deriveWorkflowStatus(input);

  const flatSteps: FlatStep[] = [];
  const pendingDeps: PendingDep[] = [];
  const pendingLogs: PendingLog[] = [];
  flattenSteps(
    input.workflow.steps,
    null,
    "",
    1,
    flatSteps,
    pendingDeps,
    pendingLogs,
  );

  // Build parent -> stepId -> uuid map for dependency resolution
  const depMap = new Map<string, Map<string, string>>();
  for (const s of flatSteps) {
    const key = s.parentUUID ?? "root";
    if (!depMap.has(key)) depMap.set(key, new Map());
    depMap.get(key)!.set(s.stepId, s.uuid);
  }

  const resolvedDeps = pendingDeps
    .map((pd) => {
      const siblingMap = depMap.get(pd.parentKey);
      const dependsOnUUID = siblingMap?.get(pd.dependsOnStepId);
      return dependsOnUUID ? { stepUUID: pd.stepUUID, dependsOnUUID } : null;
    })
    .filter(
      (d): d is { stepUUID: string; dependsOnUUID: string } => d !== null,
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO workflows (id, name, metadata, total_steps, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        workflowId,
        input.workflow.name,
        input.workflow.metadata
          ? JSON.stringify(input.workflow.metadata)
          : null,
        flatSteps.length,
        status,
      ],
    );

    const BATCH_SIZE = 1000;
    for (let i = 0; i < flatSteps.length; i += BATCH_SIZE) {
      await bulkInsertSteps(
        client,
        workflowId,
        flatSteps.slice(i, i + BATCH_SIZE),
      );
    }

    await bulkInsertDeps(client, resolvedDeps);
    await bulkInsertLogs(client, pendingLogs);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return workflowId;
}

// ── Read queries ──────────────────────────────────────────────────────────────

export async function getWorkflow(id: string) {
  const result = await pool.query(
    `SELECT id, name, metadata, status, uploaded_at, expires_at, total_steps
     FROM workflows WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

const MAX_STEP_PAGE = 500;

export async function getStepsAtLevel(
  workflowId: string,
  parentId: string | null,
  cursor: string | null,
  limit: number,
) {
  const pageSize = Math.min(limit, MAX_STEP_PAGE);
  const params: unknown[] = [workflowId];

  const parentCondition = parentId
    ? `AND s.parent_step_id = $${params.push(parentId)}`
    : `AND s.parent_step_id IS NULL`;

  let cursorCondition = "";
  if (cursor) {
    const decoded = parseInt(
      Buffer.from(cursor, "base64url").toString("utf8"),
      10,
    );
    if (!isNaN(decoded)) {
      cursorCondition = `AND s.sort_order > $${params.push(decoded)}`;
    }
  }

  params.push(pageSize + 1);
  const limitParam = `$${params.length}`;

  const stepsResult = await pool.query(
    `SELECT s.id, s.step_id, s.name, s.status, s.start_time, s.end_time,
            s.is_leaf, s.depth, s.sort_order, s.hierarchy_path,
            (SELECT COUNT(*)::int FROM steps c WHERE c.parent_step_id = s.id) AS child_count
     FROM steps s
     WHERE s.workflow_id = $1 ${parentCondition} ${cursorCondition}
     ORDER BY s.sort_order
     LIMIT ${limitParam}`,
    params,
  );

  const hasMore = stepsResult.rows.length > pageSize;
  const steps = hasMore
    ? stepsResult.rows.slice(0, pageSize)
    : stepsResult.rows;

  if (steps.length === 0) {
    return { steps: [], dependencies: [], nextCursor: null };
  }

  const stepUuids = steps.map((s: { id: string }) => s.id);
  const depsResult = await pool.query(
    `SELECT step_uuid AS "from", depends_on_uuid AS "to"
     FROM step_dependencies
     WHERE step_uuid = ANY($1)`,
    [stepUuids],
  );

  const nextCursor = hasMore
    ? Buffer.from(String(steps[steps.length - 1].sort_order)).toString(
        "base64url",
      )
    : null;

  return { steps, dependencies: depsResult.rows, nextCursor };
}

export async function getStepDetail(workflowId: string, stepUuid: string) {
  const stepResult = await pool.query(
    `SELECT id, step_id, name, status, start_time, end_time, is_leaf, depth,
            hierarchy_path,
            (SELECT COUNT(*)::int FROM steps c WHERE c.parent_step_id = s.id) AS child_count
     FROM steps s
     WHERE s.id = $1 AND s.workflow_id = $2`,
    [stepUuid, workflowId],
  );

  if (stepResult.rows.length === 0) return null;
  const step = stepResult.rows[0];

  const pathParts = (step.hierarchy_path as string).split("/").filter(Boolean);

  // Build ancestor paths: /a, /a/b, /a/b/c, … including the current step's own path
  const ancestorPaths = pathParts.map(
    (_, i) => "/" + pathParts.slice(0, i + 1).join("/"),
  );

  const ancestorsResult = await pool.query(
    `SELECT id, step_id, name, depth
     FROM steps
     WHERE workflow_id = $1 AND hierarchy_path = ANY($2)
     ORDER BY depth`,
    [workflowId, ancestorPaths],
  );

  const breadcrumbs = ancestorsResult.rows.map((r) => ({
    uuid: r.id,
    stepId: r.step_id,
    name: r.name,
  }));

  return { step, breadcrumbs };
}

export async function queryLogs(
  workflowId: string,
  stepPath: string,
  limit: number,
  cursor: string | null,
): Promise<{ lines: LogLine[]; nextCursor: string | null }> {
  let offset = 0;
  if (cursor) {
    const decoded = parseInt(
      Buffer.from(cursor, "base64url").toString("utf8"),
      10,
    );
    if (!isNaN(decoded)) offset = decoded;
  }

  const result = await pool.query(
    `SELECT s.step_id, s.hierarchy_path, s.depth, sl.log_text
     FROM steps s
     JOIN step_logs sl ON sl.step_uuid = s.id
     WHERE s.workflow_id = $1
       AND s.is_leaf = true
       AND (s.hierarchy_path = $2 OR s.hierarchy_path LIKE $3)
     ORDER BY s.sort_order`,
    [workflowId, stepPath, stepPath + "/%"],
  );

  const allLines: LogLine[] = [];
  for (const row of result.rows) {
    const logLines = (row.log_text as string).split("\n");
    for (let i = 0; i < logLines.length; i++) {
      const line = logLines[i];
      if (line === "" && i === logLines.length - 1) continue;
      allLines.push({
        timestampNs: String(allLines.length),
        line: line || " ",
        stepPath: row.hierarchy_path as string,
        stepId: row.step_id as string,
        depth: String(row.depth),
      });
    }
  }

  const page = allLines.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const nextCursor =
    nextOffset < allLines.length
      ? Buffer.from(String(nextOffset)).toString("base64url")
      : null;

  return { lines: page, nextCursor };
}
