import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and, isNull, sql, like, or } from "drizzle-orm";
import { workflows, steps, stepDependencies, stepLogs } from "./schema.js";
import type { WorkflowInput, FlatStep } from "./types.js";
import type { StepInput } from "./types.js";

const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "workflowui",
  user: process.env.PGUSER ?? "workflowui",
  password: process.env.PGPASSWORD ?? "workflowui",
});

export const db = drizzle(pool);

// ── Flatten tree ─────────────────────────────────────────────────────────────

function flattenSteps(
  stepsInput: StepInput[],
  parentTempId: string | null,
  parentPath: string,
  depth: number,
  out: FlatStep[],
): void {
  for (let i = 0; i < stepsInput.length; i++) {
    const s = stepsInput[i];
    const hierarchyPath = `${parentPath}/${s.id}`;
    const tempId = hierarchyPath;
    const isLeaf = s.steps.length === 0;

    out.push({
      tempId,
      stepId: s.id,
      parentTempId,
      hierarchyPath,
      name: s.metadata.name,
      uri: s.metadata.uri,
      pin: s.metadata.pin,
      status: s.status,
      startTime: s.metadata.startTime,
      endTime: s.metadata.endTime,
      isLeaf,
      depth,
      sortOrder: i,
      logs: isLeaf ? (s.logs ?? "") : null,
      dependsOn: s.dependsOn,
    });

    if (s.steps.length > 0) {
      flattenSteps(s.steps, tempId, hierarchyPath, depth + 1, out);
    }
  }
}

function countSteps(stepsInput: StepInput[]): number {
  let count = 0;
  for (const s of stepsInput) {
    count++;
    count += countSteps(s.steps);
  }
  return count;
}

// ── Insert workflow ───────────────────────────────────────────────────────────

export async function insertWorkflow(
  input: WorkflowInput,
  host: string,
): Promise<{ workflowId: string; viewUrl: string }> {
  const { metadata, steps: stepsInput } = input.workflow;
  const totalSteps = countSteps(stepsInput);

  const flat: FlatStep[] = [];
  flattenSteps(stepsInput, null, "", 1, flat);

  // Determine workflow status from steps
  const allStatuses = flat.map((s) => s.status);
  let wfStatus = "passed";
  if (allStatuses.includes("failed")) wfStatus = "failed";
  else if (allStatuses.includes("running")) wfStatus = "running";
  else if (allStatuses.includes("cancelled")) wfStatus = "cancelled";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert workflow
    const wfResult = await client.query(
      `INSERT INTO workflows (name, uri, pin, start_time, end_time, total_steps, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        metadata.name,
        metadata.uri ?? null,
        metadata.pin ?? null,
        metadata.startTime ?? null,
        metadata.endTime ?? null,
        totalSteps,
        wfStatus,
      ],
    );
    const workflowId = wfResult.rows[0].id as string;

    // Build tempId → DB uuid map
    const tempToUuid = new Map<string, string>();

    // Pass 1: Insert all steps without parent_step_id (to get UUIDs for all steps first)
    const BATCH = 1000;
    for (let i = 0; i < flat.length; i += BATCH) {
      const batch = flat.slice(i, i + BATCH);
      const wfIds = batch.map(() => workflowId);
      const stepIds = batch.map((s) => s.stepId);
      const hierarchyPaths = batch.map((s) => s.hierarchyPath);
      const names = batch.map((s) => s.name);
      const uris = batch.map((s) => s.uri ?? null);
      const pins = batch.map((s) => s.pin ?? null);
      const statuses = batch.map((s) => s.status);
      const startTimes = batch.map((s) => s.startTime ?? null);
      const endTimes = batch.map((s) => s.endTime ?? null);
      const isLeafs = batch.map((s) => s.isLeaf);
      const depths = batch.map((s) => s.depth);
      const sortOrders = batch.map((s) => s.sortOrder);

      const res = await client.query(
        `INSERT INTO steps (workflow_id, step_id, parent_step_id, hierarchy_path, name, uri, pin, status, start_time, end_time, is_leaf, depth, sort_order)
         SELECT * FROM unnest(
           $1::uuid[], $2::text[], $3::uuid[], $4::text[], $5::text[],
           $6::text[], $7::text[], $8::text[], $9::timestamptz[], $10::timestamptz[],
           $11::bool[], $12::int[], $13::int[]
         ) RETURNING id`,
        [wfIds, stepIds, Array(batch.length).fill(null), hierarchyPaths, names, uris, pins, statuses, startTimes, endTimes, isLeafs, depths, sortOrders],
      );

      for (let j = 0; j < batch.length; j++) {
        tempToUuid.set(batch[j].tempId, res.rows[j].id as string);
      }
    }

    // Pass 2: Batch update parent_step_id for steps that have a parent
    const childUuids: string[] = [];
    const parentUuids: string[] = [];
    for (const s of flat) {
      if (s.parentTempId) {
        const childUuid = tempToUuid.get(s.tempId)!;
        const parentUuid = tempToUuid.get(s.parentTempId);
        if (parentUuid) {
          childUuids.push(childUuid);
          parentUuids.push(parentUuid);
        }
      }
    }
    for (let i = 0; i < childUuids.length; i += BATCH) {
      const cUuids = childUuids.slice(i, i + BATCH);
      const pUuids = parentUuids.slice(i, i + BATCH);
      await client.query(
        `UPDATE steps SET parent_step_id = u.parent_uuid
         FROM unnest($1::uuid[], $2::uuid[]) AS u(child_uuid, parent_uuid)
         WHERE steps.id = u.child_uuid`,
        [cUuids, pUuids],
      );
    }

    // Collect all dependencies and logs
    const depWorkflowIds: string[] = [];
    const depStepUuids: string[] = [];
    const depDependsOnUuids: string[] = [];

    const logWorkflowIds: string[] = [];
    const logStepUuids: string[] = [];
    const logTexts: string[] = [];

    for (const s of flat) {
      const stepUuid = tempToUuid.get(s.tempId)!;
      for (const depId of s.dependsOn) {
        const parentPrefix = s.hierarchyPath.split("/").slice(0, -1).join("/");
        const depTempId = `${parentPrefix}/${depId}`;
        const depUuid = tempToUuid.get(depTempId);
        if (depUuid) {
          depWorkflowIds.push(workflowId);
          depStepUuids.push(stepUuid);
          depDependsOnUuids.push(depUuid);
        }
      }
      if (s.isLeaf && s.logs !== null) {
        logWorkflowIds.push(workflowId);
        logStepUuids.push(stepUuid);
        logTexts.push(s.logs);
      }
    }

    // Batch insert dependencies
    for (let i = 0; i < depStepUuids.length; i += BATCH) {
      const wIds = depWorkflowIds.slice(i, i + BATCH);
      const sUuids = depStepUuids.slice(i, i + BATCH);
      const dUuids = depDependsOnUuids.slice(i, i + BATCH);
      await client.query(
        `INSERT INTO step_dependencies (workflow_id, step_uuid, depends_on_uuid)
         SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[])
         ON CONFLICT DO NOTHING`,
        [wIds, sUuids, dUuids],
      );
    }

    // Batch insert logs
    for (let i = 0; i < logStepUuids.length; i += BATCH) {
      const wIds = logWorkflowIds.slice(i, i + BATCH);
      const sUuids = logStepUuids.slice(i, i + BATCH);
      const texts = logTexts.slice(i, i + BATCH);
      await client.query(
        `INSERT INTO step_logs (workflow_id, step_uuid, log_text)
         SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[])`,
        [wIds, sUuids, texts],
      );
    }

    await client.query("COMMIT");

    const viewUrl = `http://${host}/workflows/${workflowId}`;
    return { workflowId, viewUrl };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Query functions ───────────────────────────────────────────────────────────

export async function getWorkflow(id: string) {
  const rows = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const result = await db
    .delete(workflows)
    .where(eq(workflows.id, id))
    .returning({ id: workflows.id });
  return result.length > 0;
}

export async function getStepsAtLevel(
  workflowId: string,
  parentId: string | null,
) {
  const conditions = parentId
    ? [eq(steps.workflowId, workflowId), eq(steps.parentStepId, parentId)]
    : [eq(steps.workflowId, workflowId), isNull(steps.parentStepId)];

  const stepsResult = await db
    .select()
    .from(steps)
    .where(and(...conditions))
    .orderBy(steps.sortOrder);

  // Get child counts
  const childCounts = new Map<string, number>();
  for (const s of stepsResult) {
    if (!s.isLeaf) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(steps)
        .where(eq(steps.parentStepId, s.id));
      childCounts.set(s.id, count);
    }
  }

  // Get all dependencies at this level
  const stepIds = stepsResult.map((s) => s.id);
  const deps: { from: string; to: string }[] = [];
  if (stepIds.length > 0) {
    const depRows = await db
      .select()
      .from(stepDependencies)
      .where(
        and(
          sql`${stepDependencies.stepUuid} = ANY(${sql`ARRAY[${sql.join(stepIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})`,
        ),
      );
    for (const d of depRows) {
      deps.push({ from: d.dependsOnUuid, to: d.stepUuid });
    }
  }

  return {
    steps: stepsResult.map((s) => ({
      uuid: s.id,
      stepId: s.stepId,
      name: s.name,
      uri: s.uri,
      pin: s.pin,
      status: s.status,
      startTime: s.startTime,
      endTime: s.endTime,
      isLeaf: s.isLeaf,
      childCount: childCounts.get(s.id) ?? 0,
    })),
    dependencies: deps,
  };
}

export async function getStepDetail(workflowId: string, stepUuid: string) {
  const stepRows = await db
    .select()
    .from(steps)
    .where(and(eq(steps.id, stepUuid), eq(steps.workflowId, workflowId)))
    .limit(1);
  if (!stepRows[0]) return null;
  const step = stepRows[0];

  // Build breadcrumbs by walking up hierarchy
  const parts = step.hierarchyPath.split("/").filter(Boolean);
  const breadcrumbs: { uuid: string; name: string }[] = [];
  let currentPath = "";
  for (const part of parts) {
    currentPath += `/${part}`;
    const [ancestor] = await db
      .select({ id: steps.id, name: steps.name })
      .from(steps)
      .where(and(eq(steps.workflowId, workflowId), eq(steps.hierarchyPath, currentPath)))
      .limit(1);
    if (ancestor) breadcrumbs.push({ uuid: ancestor.id, name: ancestor.name });
  }

  return {
    step: {
      uuid: step.id,
      stepId: step.stepId,
      name: step.name,
      uri: step.uri,
      pin: step.pin,
      status: step.status,
      startTime: step.startTime,
      endTime: step.endTime,
      isLeaf: step.isLeaf,
      hierarchyPath: step.hierarchyPath,
      depth: step.depth,
    },
    breadcrumbs,
  };
}

export async function getStepByUuid(stepUuid: string) {
  const stepRows = await db
    .select()
    .from(steps)
    .where(eq(steps.id, stepUuid))
    .limit(1);
  if (!stepRows[0]) return null;
  const step = stepRows[0];

  const detail = await getStepDetail(step.workflowId, stepUuid);
  if (!detail) return null;

  return { workflowId: step.workflowId, ...detail };
}

export async function getLogs(
  workflowId: string,
  stepPath: string,
  cursor: string | null,
  limit: number,
) {
  // Strip trailing slash so "/" → base="" which makes prefixPath = "/%"
  const base = stepPath.replace(/\/$/, "");
  const exactPath = base;
  const prefixPath = base ? `${base}/%` : "/%";

  const leafSteps = await db
    .select({
      id: steps.id,
      stepId: steps.stepId,
      hierarchyPath: steps.hierarchyPath,
      depth: steps.depth,
      logText: stepLogs.logText,
      sortOrder: steps.sortOrder,
    })
    .from(steps)
    .innerJoin(stepLogs, eq(stepLogs.stepUuid, steps.id))
    .where(
      and(
        eq(steps.workflowId, workflowId),
        eq(steps.isLeaf, true),
        or(eq(steps.hierarchyPath, exactPath), like(steps.hierarchyPath, prefixPath)),
      ),
    )
    .orderBy(steps.sortOrder);

  // Build flat lines array
  const allLines: {
    timestampNs: string;
    line: string;
    stepPath: string;
    stepId: string;
    depth: string;
  }[] = [];

  for (const s of leafSteps) {
    const lines = s.logText.split("\n");
    for (const line of lines) {
      if (line === "" && lines[lines.length - 1] === "" && line === lines[lines.length - 1])
        continue;
      allLines.push({
        timestampNs: "0",
        line,
        stepPath: s.hierarchyPath,
        stepId: s.stepId,
        depth: String(s.depth),
      });
    }
  }

  // Remove trailing empty line from each step's log split
  // Apply cursor
  let startIdx = 0;
  if (cursor) {
    startIdx = Number(Buffer.from(cursor, "base64url").toString());
  }

  const page = allLines.slice(startIdx, startIdx + limit);
  const hasMore = startIdx + limit < allLines.length;
  const nextCursor = hasMore
    ? Buffer.from(String(startIdx + limit)).toString("base64url")
    : null;

  return { lines: page, nextCursor };
}
