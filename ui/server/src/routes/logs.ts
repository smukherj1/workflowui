import { Router, type Request, type Response } from 'express';
import { queryLogs } from '../lib/db';

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

export default router;
