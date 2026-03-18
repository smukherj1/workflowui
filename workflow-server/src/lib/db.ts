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

    // Insert steps in batches of 1000
    const BATCH = 1000;
    for (let i = 0; i < flat.length; i += BATCH) {
      const batch = flat.slice(i, i + BATCH);
      for (const s of batch) {
        const parentUuid = s.parentTempId ? tempToUuid.get(s.parentTempId) ?? null : null;
        const res = await client.query(
          `INSERT INTO steps (workflow_id, step_id, parent_step_id, hierarchy_path, name, uri, pin, status, start_time, end_time, is_leaf, depth, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [
            workflowId,
            s.stepId,
            parentUuid,
            s.hierarchyPath,
            s.name,
            s.uri ?? null,
            s.pin ?? null,
            s.status,
            s.startTime ?? null,
            s.endTime ?? null,
            s.isLeaf,
            s.depth,
            s.sortOrder,
          ],
        );
        tempToUuid.set(s.tempId, res.rows[0].id as string);
      }
    }

    // Insert dependencies
    for (const s of flat) {
      const stepUuid = tempToUuid.get(s.tempId)!;
      for (const depId of s.dependsOn) {
        // Find the sibling with that stepId at same parent level
        const parentPrefix = s.hierarchyPath.split("/").slice(0, -1).join("/");
        const depTempId = `${parentPrefix}/${depId}`;
        const depUuid = tempToUuid.get(depTempId);
        if (depUuid) {
          await client.query(
            `INSERT INTO step_dependencies (step_uuid, depends_on_uuid) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [stepUuid, depUuid],
          );
        }
      }
    }

    // Insert logs for leaf steps
    for (const s of flat) {
      if (s.isLeaf && s.logs !== null) {
        const stepUuid = tempToUuid.get(s.tempId)!;
        await client.query(
          `INSERT INTO step_logs (step_uuid, log_text) VALUES ($1,$2)`,
          [stepUuid, s.logs],
        );
      }
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

export async function getStepsAtLevel(
  workflowId: string,
  parentId: string | null,
  cursor: string | null,
  limit: number,
) {
  // Get steps at this level
  const condition = parentId
    ? and(eq(steps.workflowId, workflowId), eq(steps.parentStepId, parentId))
    : and(eq(steps.workflowId, workflowId), isNull(steps.parentStepId));

  const stepsResult = await db
    .select()
    .from(steps)
    .where(condition)
    .orderBy(steps.sortOrder)
    .limit(limit + 1);

  // Apply cursor (sort_order offset)
  let filtered = stepsResult;
  if (cursor) {
    const offset = Number(Buffer.from(cursor, "base64url").toString());
    filtered = stepsResult.filter((s) => s.sortOrder >= offset);
  }

  const hasMore = filtered.length > limit;
  const page = filtered.slice(0, limit);

  // Get child counts
  const stepIds = page.map((s) => s.id);
  const childCounts = new Map<string, number>();
  if (stepIds.length > 0) {
    for (const s of page) {
      if (!s.isLeaf) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(steps)
          .where(eq(steps.parentStepId, s.id));
        childCounts.set(s.id, count);
      }
    }
  }

  // Get dependencies for this level
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

  const nextCursor = hasMore
    ? Buffer.from(String(page[page.length - 1].sortOrder + 1)).toString("base64url")
    : null;

  return {
    steps: page.map((s) => ({
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
    nextCursor,
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
