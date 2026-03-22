import { z } from "zod";
import type { StepInput, WorkflowInput } from "./types.js";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const metadataSchema = z.object({
  name: z.string().min(1),
  uri: z.string().optional(),
  pin: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

const stepStatuses = ["passed", "failed", "running", "skipped", "cancelled"] as const;

const stepSchema: z.ZodType<StepInput> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    metadata: metadataSchema,
    status: z.enum(stepStatuses),
    dependsOn: z.array(z.string()).default([]),
    logs: z.string().nullable().default(null),
    steps: z.array(stepSchema).default([]),
  }),
);

export const workflowSchema = z.object({
  workflow: z.object({
    metadata: metadataSchema,
    steps: z.array(stepSchema),
  }),
});

// ── Structural + DAG validation ──────────────────────────────────────────────

const MAX_STEPS_PER_LEVEL = 10_000;
const MAX_DEPS_PER_STEP = 100;
const MAX_LOG_BYTES_PER_LEAF = 10 * 1024 * 1024;
const MAX_TOTAL_LOG_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 10;

interface ValidationContext {
  totalLogBytes: number;
  totalSteps: number;
}

function detectCycle(steps: StepInput[]): string | null {
  const ids = new Set(steps.map((s) => s.id));
  const inDegree: Record<string, number> = {};
  const adj: Record<string, string[]> = {};

  for (const s of steps) {
    inDegree[s.id] = inDegree[s.id] ?? 0;
    adj[s.id] = adj[s.id] ?? [];
    for (const dep of s.dependsOn) {
      if (!ids.has(dep)) continue;
      adj[dep] = adj[dep] ?? [];
      adj[dep].push(s.id);
      inDegree[s.id] = (inDegree[s.id] ?? 0) + 1;
    }
  }

  const queue = steps.filter((s) => (inDegree[s.id] ?? 0) === 0).map((s) => s.id);
  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj[node] ?? []) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  return visited < steps.length ? "Cycle detected in dependsOn" : null;
}

function validateStepsRecursive(
  steps: StepInput[],
  depth: number,
  ctx: ValidationContext,
): string | null {
  if (depth > MAX_DEPTH) return `Hierarchy depth exceeds ${MAX_DEPTH}`;
  if (steps.length > MAX_STEPS_PER_LEVEL)
    return `Steps per level exceeds ${MAX_STEPS_PER_LEVEL}`;

  const cycleError = detectCycle(steps);
  if (cycleError) return cycleError;

  for (const step of steps) {
    ctx.totalSteps++;
    if (step.dependsOn.length > MAX_DEPS_PER_STEP)
      return `Step "${step.id}" exceeds ${MAX_DEPS_PER_STEP} dependencies`;

    if (step.logs !== null) {
      const bytes = Buffer.byteLength(step.logs, "utf8");
      if (bytes > MAX_LOG_BYTES_PER_LEAF)
        return `Step "${step.id}" log exceeds 10MB`;
      ctx.totalLogBytes += bytes;
      if (ctx.totalLogBytes > MAX_TOTAL_LOG_BYTES)
        return "Total logs exceed 50MB";
    }

    if (step.steps.length > 0) {
      const err = validateStepsRecursive(step.steps, depth + 1, ctx);
      if (err) return err;
    }
  }
  return null;
}

export function validateStructureAndDAG(input: WorkflowInput): string | null {
  const ctx: ValidationContext = { totalLogBytes: 0, totalSteps: 0 };
  return validateStepsRecursive(input.workflow.steps, 1, ctx);
}
