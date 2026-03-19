import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { workflowSchema, validateStructureAndDAG } from "../lib/validation.js";
import { insertWorkflow, getWorkflow } from "../lib/db.js";

const router = new Hono();

// POST /api/workflows
router.post("/", async (c) => {
  // Size check
  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (contentLength > 60 * 1024 * 1024) {
    return c.json({ error: "Payload too large" }, 413);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = workflowSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, details: parsed.error.issues }, 400);
  }

  const structErr = validateStructureAndDAG(parsed.data as any);
  if (structErr) {
    return c.json({ error: "STRUCTURAL_INVALID", details: structErr }, 400);
  }

  try {
    const host = c.req.header("host") ?? "localhost:3001";
    const result = await insertWorkflow(parsed.data as any, host);
    return c.json(result, 201);
  } catch (err) {
    console.error("Upload error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/workflows/:id
router.get(
  "/:id",
  zValidator("param", z.object({ id: z.string().uuid() })),
  async (c) => {
    const { id } = c.req.valid("param");
    const wf = await getWorkflow(id);
    if (!wf) return c.json({ error: "Not found" }, 404);

    return c.json({
      id: wf.id,
      name: wf.name,
      uri: wf.uri,
      pin: wf.pin,
      startTime: wf.startTime,
      endTime: wf.endTime,
      status: wf.status,
      totalSteps: wf.totalSteps,
      uploadedAt: wf.uploadedAt,
      expiresAt: wf.expiresAt,
    });
  },
);

export default router;
