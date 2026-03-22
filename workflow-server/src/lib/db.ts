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
      logs: isLeaf ? (s.logs ?? null) : null,
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

  const workflowId = await db.transaction(async (tx) => {
    // Insert workflow
    const [wfRow] = await tx
      .insert(workflows)
      .values({
        name: metadata.name,
        uri: metadata.uri ?? null,
        pin: metadata.pin ?? null,
        startTime: metadata.startTime ? new Date(metadata.startTime) : null,
        endTime: metadata.endTime ? new Date(metadata.endTime) : null,
        totalSteps,
        status: wfStatus,
      })
      .returning({ id: workflows.id });
    const wfId = wfRow.id;

    // Build tempId → DB uuid map
    const tempToUuid = new Map<string, string>();

    // Pass 1: Insert all steps without parent_step_id (to get UUIDs for all steps first)
    const BATCH = 1000;
    for (let i = 0; i < flat.length; i += BATCH) {
      const batch = flat.slice(i, i + BATCH);
      const rows = await tx
        .insert(steps)
        .values(
          batch.map((s) => ({
            workflowId: wfId,
            stepId: s.stepId,
            parentStepId: null as string | null,
            hierarchyPath: s.hierarchyPath,
            name: s.name,
            uri: s.uri ?? null,
            pin: s.pin ?? null,
            status: s.status,
            startTime: s.startTime ? new Date(s.startTime) : null,
            endTime: s.endTime ? new Date(s.endTime) : null,
            isLeaf: s.isLeaf,
            depth: s.depth,
            sortOrder: s.sortOrder,
          })),
        )
        .returning({ id: steps.id });

      for (let j = 0; j < batch.length; j++) {
        tempToUuid.set(batch[j].tempId, rows[j].id);
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
      await tx.execute(
        sql`UPDATE steps SET parent_step_id = u.parent_uuid
            FROM unnest(
              ARRAY[${sql.join(cUuids.map((id) => sql`${id}::uuid`), sql`, `)}],
              ARRAY[${sql.join(pUuids.map((id) => sql`${id}::uuid`), sql`, `)}]
            ) AS u(child_uuid, parent_uuid)
            WHERE steps.id = u.child_uuid`,
      );
    }

    // Collect all dependencies and logs
    const depRows: (typeof stepDependencies.$inferInsert)[] = [];
    const logRows: (typeof stepLogs.$inferInsert)[] = [];

    for (const s of flat) {
      const stepUuid = tempToUuid.get(s.tempId)!;
      for (const depId of s.dependsOn) {
        const parentPrefix = s.hierarchyPath.split("/").slice(0, -1).join("/");
        const depTempId = `${parentPrefix}/${depId}`;
        const depUuid = tempToUuid.get(depTempId);
        if (depUuid) {
          depRows.push({ workflowId: wfId, stepUuid, dependsOnUuid: depUuid });
        }
      }
      if (s.isLeaf && s.logs !== null) {
        for (let i = 0; i < s.logs.length; i++) {
          const entry = s.logs[i];
          logRows.push({
            workflowId: wfId,
            stepUuid,
            lineNumber: i,
            content: entry.content,
            timestamp: entry.timestamp ? new Date(entry.timestamp) : null,
          });
        }
      }
    }

    // Batch insert dependencies
    for (let i = 0; i < depRows.length; i += BATCH) {
      await tx.insert(stepDependencies).values(depRows.slice(i, i + BATCH));
    }

    // Batch insert logs
    for (let i = 0; i < logRows.length; i += BATCH) {
      await tx.insert(stepLogs).values(logRows.slice(i, i + BATCH));
    }

    return wfId;
  });

  const viewUrl = `http://${host}/workflows/${workflowId}`;
  return { workflowId, viewUrl };
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

  const logEntries = await db
    .select({
      content: stepLogs.content,
      timestamp: stepLogs.timestamp,
      stepId: steps.stepId,
      stepPath: steps.hierarchyPath,
      depth: steps.depth,
      lineNumber: stepLogs.lineNumber,
      sortOrder: steps.sortOrder,
    })
    .from(stepLogs)
    .innerJoin(steps, eq(steps.id, stepLogs.stepUuid))
    .where(
      and(
        eq(steps.workflowId, workflowId),
        eq(steps.isLeaf, true),
        or(eq(steps.hierarchyPath, exactPath), like(steps.hierarchyPath, prefixPath)),
      ),
    )
    .orderBy(steps.sortOrder, stepLogs.lineNumber);

  // Build flat lines array
  const allLines: {
    content: string;
    timestamp: string | null;
    stepPath: string;
    stepId: string;
    depth: string;
  }[] = [];

  for (const e of logEntries) {
    allLines.push({
      content: e.content,
      timestamp: e.timestamp ? e.timestamp.toISOString() : null,
      stepPath: e.stepPath,
      stepId: e.stepId,
      depth: String(e.depth),
    });
  }

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
