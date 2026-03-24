import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { searchWorkflows, searchSteps } from "../lib/db.js";

const router = new Hono();

const querySchema = z.object({
  q: z.string().min(1),
  scope: z.enum(["workflows", "steps", "all"]).optional().default("all"),
  workflowId: z.uuid().optional(),
  field: z.enum(["name", "uri", "pin", "path"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// GET /api/search
router.get("/", zValidator("query", querySchema), async (c) => {
  const { q, scope, workflowId, field, from, to, limit } = c.req.valid("query");

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  const results: unknown[] = [];

  if (scope === "workflows" || scope === "all") {
    // path field is step-specific; ignore it for workflow search
    const wfField = field === "path" ? null : (field ?? null);
    const wfResults = await searchWorkflows(
      q,
      wfField,
      fromDate,
      toDate,
      limit,
    );
    results.push(...wfResults);
  }

  if (scope === "steps" || scope === "all") {
    const stepResults = await searchSteps(
      q,
      workflowId ?? null,
      field ?? null,
      fromDate,
      toDate,
      limit,
    );
    results.push(...stepResults);
  }

  // Trim to limit when scope is "all"
  return c.json({ results: results.slice(0, limit) });
});

export default router;
