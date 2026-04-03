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
    workflowId: z.uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict()
  .refine((d) => d.q || d.name || d.uri || d.pin || d.path, {
    message:
      "At least one search term (q, name, uri, pin, or path) is required",
  })
  .refine((d) => !(d.path && !d.workflowId), {
    message: "path filter requires workflowId",
  });

// GET /api/search
router.get("/", zValidator("query", querySchema), async (c) => {
  const { q, name, uri, pin, path, workflowId, from, to, limit } =
    c.req.valid("query");

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (workflowId) {
    // Step search scoped to a workflow
    const results = await searchSteps(
      { q, name, uri, pin, path },
      workflowId,
      fromDate,
      toDate,
      limit,
    );
    return c.json({ results });
  }

  // Workflow-only search
  const results = await searchWorkflows(
    { q, name, uri, pin },
    fromDate,
    toDate,
    limit,
  );
  return c.json({ results });
});

export default router;
