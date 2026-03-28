import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { searchWorkflows, searchSteps } from "../lib/db.js";

const router = new Hono();

const querySchema = z
  .object({
    q: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    uri: z.string().min(1).optional(),
    pin: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    scope: z.enum(["workflows", "steps", "all"]).optional().default("all"),
    workflowId: z.uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict()
  .refine((d) => d.q || d.name || d.uri || d.pin || d.path, {
    message:
      "At least one search term (q, name, uri, pin, or path) is required",
  });

// GET /api/search
router.get("/", zValidator("query", querySchema), async (c) => {
  const { q, name, uri, pin, path, scope, workflowId, from, to, limit } =
    c.req.valid("query");

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  const results: unknown[] = [];

  if (scope === "workflows" || scope === "all") {
    // path is step-specific; skip workflow search if path is the only filter
    if (q || name || uri || pin) {
      const wfResults = await searchWorkflows(
        { q, name, uri, pin },
        fromDate,
        toDate,
        limit,
      );
      results.push(...wfResults);
    }
  }

  if (scope === "steps" || scope === "all") {
    const stepResults = await searchSteps(
      { q, name, uri, pin, path },
      workflowId ?? null,
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
