import { Pool, PoolClient } from "pg";
import { randomUUID } from "crypto";
import type {
  WorkflowInput,
  WorkflowStep,
  FlatStep,
  PendingDep,
} from "./types";

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

    if (!isLeaf) {
      flattenSteps(
        step.steps,
        uuid,
        hierarchyPath,
        depth + 1,
        flatSteps,
        pendingDeps,
      );
    }
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
  flattenSteps(input.workflow.steps, null, "", 1, flatSteps, pendingDeps);

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

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return workflowId;
}
