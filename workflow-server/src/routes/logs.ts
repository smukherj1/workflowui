import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getLogs } from "../lib/db.js";

const router = new Hono();

// GET /api/workflows/:id/logs?stepPath=&cursor=&limit=
router.get(
  "/:id/logs",
  zValidator("param", z.object({ id: z.string().uuid() })),
  zValidator(
    "query",
    z.object({
      stepPath: z.string().min(1),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(10000).default(1000),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const { stepPath, cursor, limit } = c.req.valid("query");

    const result = await getLogs(id, stepPath, cursor ?? null, limit);
    return c.json(result);
  },
);

export default router;
