import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  workflowSchema,
  validateStructureAndDAG,
  formatSchemaErrors,
} from "../lib/validation.js";
import {
  insertWorkflow,
  getWorkflow,
  deleteWorkflow,
  getBreadcrumbsByPath,
} from "../lib/db.js";

const router = new Hono();

// POST /api/workflows
router.post("/", async (c) => {
  let rawText: string;
  try {
    rawText = await c.req.text();
  } catch {
    return c.json(
      {
        error: "INVALID_JSON",
        summary: "The uploaded file is not valid JSON",
        details: ["Failed to read request body"],
        totalErrors: 1,
      },
      400,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch (err) {
    return c.json(
      {
        error: "INVALID_JSON",
        summary: "The uploaded file is not valid JSON",
        details: [`JSON syntax error: ${(err as Error).message}`],
        totalErrors: 1,
      },
      400,
    );
  }

  const parsed = workflowSchema.safeParse(body);
  if (!parsed.success) {
    const formatted = formatSchemaErrors(parsed.error);
    return c.json(
      {
        error: "SCHEMA_INVALID",
        summary: formatted.summary,
        details: formatted.items,
        totalErrors: formatted.totalErrors,
      },
      400,
    );
  }

  const structErr = validateStructureAndDAG(parsed.data);
  if (structErr) {
    return c.json(
      {
        error: "STRUCTURAL_INVALID",
        summary: structErr.summary,
        details: structErr.items,
        totalErrors: structErr.totalErrors,
      },
      400,
    );
  }

  try {
    const host = c.req.header("host") ?? "localhost:3001";
    const result = await insertWorkflow(parsed.data, host);
    return c.json(result, 201);
  } catch (err) {
    console.error("POST /api/workflows: Upload error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/workflows/:id
router.get(
  "/:id",
  zValidator("param", z.object({ id: z.uuid() })),
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

// GET /api/workflows/:id/breadcrumbs?stepPath=
router.get(
  "/:id/breadcrumbs",
  zValidator("param", z.object({ id: z.uuid() })),
  zValidator("query", z.object({ stepPath: z.string().min(1) })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { stepPath } = c.req.valid("query");
    const breadcrumbs = await getBreadcrumbsByPath(id, stepPath);
    return c.json({ breadcrumbs });
  },
);

// DELETE /api/workflows/:id
router.delete(
  "/:id",
  zValidator("param", z.object({ id: z.uuid() })),
  async (c) => {
    const { id } = c.req.valid("param");
    const deleted = await deleteWorkflow(id);
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.body(null, 204);
  },
);

export default router;
