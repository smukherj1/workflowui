import { Router, type Request, type Response } from 'express';
import { queryLogs, getStepDetail } from '../lib/db';
import { buildGrafanaExploreUrl } from '../lib/grafana';

const router = Router();

// GET /api/workflows/:id/logs?stepPath=&limit=&cursor=
router.get('/:id/logs', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const stepPath = typeof req.query.stepPath === 'string' ? req.query.stepPath : null;
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1000);

  if (!stepPath) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'stepPath query param is required' });
    return;
  }

  try {
    const result = await queryLogs(id, stepPath, limit, cursor);
    res.json(result);
  } catch (err) {
    console.error('DB log query error:', err);
    res.status(500).json({ error: 'DB_ERROR', message: 'Failed to query logs' });
  }
});

// GET /api/workflows/:id/steps/:uuid/logs/explore  →  302 redirect to Grafana
router.get('/:id/steps/:uuid/logs/explore', async (req: Request, res: Response): Promise<void> => {
  const { id, uuid } = req.params;

  try {
    const detail = await getStepDetail(id, uuid);
    if (!detail) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Step not found' });
      return;
    }

    const grafanaUrl = buildGrafanaExploreUrl(id, detail.step.hierarchy_path as string);
    res.redirect(302, grafanaUrl);
  } catch (err) {
    console.error('Error building Grafana URL:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Failed to build Grafana URL' });
  }
});

export default router;
