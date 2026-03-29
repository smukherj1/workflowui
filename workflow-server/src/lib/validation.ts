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

const stepStatuses = [
  "passed",
  "failed",
  "running",
  "skipped",
  "cancelled",
] as const;

const logEntrySchema = z.object({
  content: z.string(),
  timestamp: z.string().optional(),
});

const stepSchema: z.ZodType<StepInput> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    metadata: metadataSchema,
    status: z.enum(stepStatuses),
    dependsOn: z.array(z.string()).default([]),
    logs: z.array(logEntrySchema).nullable().default(null),
    steps: z.array(stepSchema).default([]),
  }),
);

export const workflowSchema = z.object({
  workflow: z.object({
    metadata: metadataSchema,
    steps: z.array(stepSchema),
  }),
});

// ── Formatted Validation Errors ──────────────────────────────────────────────

export interface FormattedValidationError {
  /** Human-readable summary, e.g. "3 validation errors (showing first 3)" */
  summary: string;
  /** Individual error strings with field paths */
  items: string[];
  /** Total number of errors (may exceed items.length) */
  totalErrors: number;
}

const MAX_DISPLAYED_ERRORS = 3;

export function formatSchemaErrors(
  zodError: z.ZodError,
): FormattedValidationError {
  const issues = zodError.issues;
  const total = issues.length;
  const shown = issues.slice(0, MAX_DISPLAYED_ERRORS);

  const items = shown.map((issue) => {
    const fieldPath = issue.path
      .map((seg, i) =>
        typeof seg === "number" ? `[${seg}]` : (i > 0 ? "." : "") + String(seg),
      )
      .join("");

    let msg = issue.message;

    if (issue.code === "invalid_value") {
      const expected = (issue as z.core.$ZodIssueInvalidValue).values
        ?.map(String)
        .join(" | ");
      if (expected) msg += `. Expected: ${expected}`;
    }

    return `${fieldPath || "(root)"}: ${msg}`;
  });

  const hiddenCount = total - shown.length;
  const summary =
    total === 1
      ? "1 validation error"
      : hiddenCount > 0
        ? `${total} validation errors (showing first ${MAX_DISPLAYED_ERRORS}; ${hiddenCount} more)`
        : `${total} validation errors`;

  return { summary, items, totalErrors: total };
}

// ── Structural + DAG validation ──────────────────────────────────────────────

const MAX_STEPS_PER_LEVEL = 10_000;
const MAX_DEPS_PER_STEP = 100;
const MAX_LOG_BYTES_PER_LEAF = 10 * 1024 * 1024;
const MAX_TOTAL_LOG_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 10;
const MAX_STRUCTURAL_ERRORS = 20;

interface ValidationContext {
  totalLogBytes: number;
  totalSteps: number;
}

function detectCycle(steps: StepInput[]): string | null {
  type DFSNode = {
    id: string;
    parentId: string | null;
  };
  const lookup = new Map<string, StepInput>(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  for (const step of steps) {
    if (visited.has(step.id)) continue;

    const exploring = new Map<string, DFSNode>();
    const stack: DFSNode[] = [{ id: step.id, parentId: null }];

    const tracePath = (rootId: string, curId: string): string[] => {
      const path: string[] = [];
      while (true) {
        const cur = exploring.get(curId);
        // Special case, we were unable to trace the path back to the root.
        // This can happen if the node directly depends on itself. Otherwise, it
        // indicates a bug in the cycle detection logic.
        if (cur === undefined) return [];
        path.push(cur.id);
        if (cur.id === rootId) break;
        curId = cur.parentId!;
      }
      return path.reverse();
    };

    while (stack.length > 0) {
      const head = stack.pop()!;
      if (exploring.has(head.id)) {
        exploring.delete(head.id);
        visited.add(head.id);
        continue;
      }
      exploring.set(head.id, head);
      stack.push(head); // revisit after exploring dependencies

      const headNode = lookup.get(head.id)!;
      for (const depId of headNode.dependsOn) {
        if (depId === head.id) {
          return `Cycle detected: Step "${head.id}" depends on itself`;
        }
        if (!lookup.has(depId)) {
          return `Step "${head.id}" depends on non-existent step "${depId}"`;
        }
        if (visited.has(depId)) continue;
        if (exploring.has(depId)) {
          const cyclePath = tracePath(depId, head.id);
          cyclePath.push(depId); // complete the cycle for display
          return `Cycle detected: ${cyclePath.map((id) => `Step "${id}"`).join(" -- depends on --> ")}`;
        }
        stack.push({ id: depId, parentId: head.id });
      }
    }
  }
  return null;
}

function validateStepsRecursive(
  steps: StepInput[],
  depth: number,
  ctx: ValidationContext,
  errors: string[],
): void {
  if (errors.length >= MAX_STRUCTURAL_ERRORS) return;

  if (depth > MAX_DEPTH) {
    errors.push(`Hierarchy depth exceeds ${MAX_DEPTH}`);
    return;
  }
  if (steps.length > MAX_STEPS_PER_LEVEL) {
    errors.push(`Steps per level exceeds ${MAX_STEPS_PER_LEVEL}`);
    return;
  }

  const cycleError = detectCycle(steps);
  if (cycleError) errors.push(`${cycleError} at depth ${depth}`);

  for (const step of steps) {
    if (errors.length >= MAX_STRUCTURAL_ERRORS) return;
    ctx.totalSteps++;
    if (step.dependsOn.length > MAX_DEPS_PER_STEP) {
      errors.push(
        `Step "${step.id}" exceeds ${MAX_DEPS_PER_STEP} dependencies`,
      );
    }

    if (step.logs !== null) {
      const bytes = step.logs.reduce(
        (sum, entry) => sum + Buffer.byteLength(entry.content, "utf8"),
        0,
      );
      if (bytes > MAX_LOG_BYTES_PER_LEAF) {
        errors.push(`Step "${step.id}" log exceeds 10MB`);
      }
      ctx.totalLogBytes += bytes;
      if (ctx.totalLogBytes > MAX_TOTAL_LOG_BYTES) {
        errors.push("Total logs exceed 50MB");
        return;
      }
    }

    if (step.steps.length > 0) {
      validateStepsRecursive(step.steps, depth + 1, ctx, errors);
    }
  }
}

export function validateStructureAndDAG(
  input: WorkflowInput,
): FormattedValidationError | null {
  const ctx: ValidationContext = { totalLogBytes: 0, totalSteps: 0 };
  const errors: string[] = [];
  validateStepsRecursive(input.workflow.steps, 1, ctx, errors);

  if (errors.length === 0) return null;

  const shown = errors.slice(0, MAX_DISPLAYED_ERRORS);
  const hidden = errors.length - shown.length;
  return {
    summary:
      errors.length === 1
        ? "1 structural error"
        : hidden > 0
          ? `${errors.length} structural errors (showing first ${MAX_DISPLAYED_ERRORS}; ${hidden} more)`
          : `${errors.length} structural errors`,
    items: shown,
    totalErrors: errors.length,
  };
}
