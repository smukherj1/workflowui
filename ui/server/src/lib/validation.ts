import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { WorkflowInput, WorkflowStep } from './types';

const MAX_STEPS_PER_LEVEL = 1_000_000;
const MAX_DEPS_PER_STEP = 100;
const MAX_LEAF_LOG_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_LOG_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 10;

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema',
  type: 'object',
  required: ['workflow'],
  additionalProperties: false,
  properties: {
    workflow: {
      type: 'object',
      required: ['name', 'steps'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        metadata: { type: 'object' },
        steps: { type: 'array', items: { $ref: '#/definitions/step' } },
      },
    },
  },
  definitions: {
    step: {
      type: 'object',
      required: ['id', 'name', 'status', 'dependsOn', 'steps'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        status: {
          type: 'string',
          enum: ['passed', 'failed', 'running', 'skipped', 'cancelled'],
        },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        dependsOn: { type: 'array', items: { type: 'string' } },
        logs: { type: ['string', 'null'] },
        steps: { type: 'array', items: { $ref: '#/definitions/step' } },
      },
    },
  },
};

const validateSchema = ajv.compile(schema);

// Detect cycles among sibling steps using DFS
function detectCycle(steps: WorkflowStep[]): string | null {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    const step = stepMap.get(id);
    if (step) {
      for (const dep of step.dependsOn) {
        if (dfs(dep)) return true;
      }
    }
    inStack.delete(id);
    return false;
  }

  for (const step of steps) {
    if (!visited.has(step.id) && dfs(step.id)) {
      return step.id;
    }
  }
  return null;
}

interface Limits {
  totalLogBytes: number;
}

function walkSteps(
  steps: WorkflowStep[],
  depth: number,
  limits: Limits
): string | null {
  if (depth > MAX_DEPTH) {
    return `Hierarchy depth exceeds maximum of ${MAX_DEPTH}`;
  }
  if (steps.length > MAX_STEPS_PER_LEVEL) {
    return `Steps per level (${steps.length}) exceeds maximum of ${MAX_STEPS_PER_LEVEL.toLocaleString()}`;
  }

  // Check unique sibling IDs
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) {
      return `Duplicate step id "${step.id}" at depth ${depth}`;
    }
    ids.add(step.id);
  }

  // Validate dependsOn references sibling IDs only
  for (const step of steps) {
    if (step.dependsOn.length > MAX_DEPS_PER_STEP) {
      return `Step "${step.id}" has ${step.dependsOn.length} dependencies; max is ${MAX_DEPS_PER_STEP}`;
    }
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) {
        return `Step "${step.id}" depends on unknown sibling "${dep}"`;
      }
    }
  }

  // Cycle detection at this level
  const cycleId = detectCycle(steps);
  if (cycleId) {
    return `Cycle detected involving step "${cycleId}" at depth ${depth}`;
  }

  // Walk each step
  for (const step of steps) {
    if (step.steps.length === 0 && step.logs != null) {
      const bytes = Buffer.byteLength(step.logs, 'utf8');
      if (bytes > MAX_LEAF_LOG_BYTES) {
        return `Step "${step.id}" logs exceed 10 MB`;
      }
      limits.totalLogBytes += bytes;
      if (limits.totalLogBytes > MAX_TOTAL_LOG_BYTES) {
        return `Total log size exceeds 50 MB`;
      }
    }
    if (step.steps.length > 0) {
      const err = walkSteps(step.steps, depth + 1, limits);
      if (err) return err;
    }
  }

  return null;
}

export type ValidationResult =
  | { valid: true; input: WorkflowInput }
  | { valid: false; error: string; details?: unknown };

export function validateWorkflow(data: unknown): ValidationResult {
  const ok = validateSchema(data);
  if (!ok) {
    return {
      valid: false,
      error: 'JSON_SCHEMA_INVALID',
      details: validateSchema.errors,
    };
  }

  const input = data as unknown as WorkflowInput;
  const limits: Limits = { totalLogBytes: 0 };
  const structErr = walkSteps(input.workflow.steps, 1, limits);
  if (structErr) {
    return { valid: false, error: 'STRUCTURAL_INVALID', details: structErr };
  }

  return { valid: true, input };
}
