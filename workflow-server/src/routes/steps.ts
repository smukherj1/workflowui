import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getStepsAtLevel, getStepDetail, getStepByUuid } from "../lib/db.js";

const router = new Hono();

// GET /api/workflows/:id/steps?parentId=&cursor=&limit=
router.get(
  "/:id/steps",
  zValidator("param", z.object({ id: z.string().uuid() })),
  zValidator(
    "query",
    z.object({
      parentId: z.string().uuid().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(1000).default(1000),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const { parentId, cursor, limit } = c.req.valid("query");

    const result = await getStepsAtLevel(id, parentId ?? null, cursor ?? null, limit);
    return c.json(result);
  },
);

// GET /api/workflows/:id/steps/:uuid
router.get(
  "/:id/steps/:uuid",
  zValidator(
    "param",
    z.object({ id: z.string().uuid(), uuid: z.string().uuid() }),
  ),
  async (c) => {
    const { id, uuid } = c.req.valid("param");
    const result = await getStepDetail(id, uuid);
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  },
);

// GET /api/steps/:uuid (cross-workflow lookup)
export const stepsGlobalRouter = new Hono();

stepsGlobalRouter.get(
  "/:uuid",
  zValidator("param", z.object({ uuid: z.string().uuid() })),
  async (c) => {
    const { uuid } = c.req.valid("param");
    const result = await getStepByUuid(uuid);
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  },
);

export default router;
