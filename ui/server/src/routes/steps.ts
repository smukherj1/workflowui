import { Router, type Request, type Response } from "express";
import { getStepsAtLevel, getStepDetail } from "../lib/db";

const router = Router();

function elapsedMs(
  startTime: Date | null,
  endTime: Date | null,
): number | null {
  if (!startTime || !endTime) return null;
  return endTime.getTime() - startTime.getTime();
}

function formatStep(row: Record<string, unknown>) {
  return {
    uuid: row.id,
    stepId: row.step_id,
    name: row.name,
    status: row.status,
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
    elapsedMs: elapsedMs(
      row.start_time as Date | null,
      row.end_time as Date | null,
    ),
    isLeaf: row.is_leaf,
    childCount: row.child_count ?? 0,
    hierarchyPath: row.hierarchy_path,
  };
}

// GET /api/workflows/:id/steps?parentId=&cursor=&limit=
router.get("/:id/steps", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const parentId =
    typeof req.query.parentId === "string" ? req.query.parentId : null;
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
  const defaultLimit = 1000;
  const limit = Math.min(
    parseInt(String(req.query.limit ?? `${defaultLimit}`), 10) || defaultLimit,
    defaultLimit,
  );

  try {
    const result = await getStepsAtLevel(id, parentId, cursor, limit);
    res.json({
      steps: result.steps.map(formatStep),
      dependencies: result.dependencies,
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    console.error("DB error fetching steps:", err);
    res
      .status(500)
      .json({ error: "DB_ERROR", message: "Failed to fetch steps" });
  }
});

// GET /api/workflows/:id/steps/:uuid
router.get(
  "/:id/steps/:uuid",
  async (req: Request, res: Response): Promise<void> => {
    const { id, uuid } = req.params;

    try {
      const result = await getStepDetail(id, uuid);
      if (!result) {
        res.status(404).json({ error: "NOT_FOUND", message: "Step not found" });
        return;
      }
      res.json({
        step: formatStep(result.step as Record<string, unknown>),
        breadcrumbs: result.breadcrumbs,
      });
    } catch (err) {
      console.error("DB error fetching step detail:", err);
      res
        .status(500)
        .json({ error: "DB_ERROR", message: "Failed to fetch step" });
    }
  },
);

export default router;
