import { Router, type Request, type Response } from 'express';
import { validateWorkflow } from '../lib/validation';
import { insertWorkflow } from '../lib/db';
import { pushLogsToLoki } from '../lib/loki';

const router = Router();

const MAX_BODY_BYTES = 60 * 1024 * 1024;

router.post('/', async (req: Request, res: Response): Promise<void> => {
  // Size guard via Content-Length header
  const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    res.status(400).json({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Workflow JSON must be under 60 MB',
    });
    return;
  }

  const result = validateWorkflow(req.body);
  if (!result.valid) {
    res.status(400).json({ error: result.error, details: result.details });
    return;
  }

  let workflowId: string;
  try {
    workflowId = await insertWorkflow(result.input);
  } catch (err) {
    console.error('DB insert failed:', err);
    res.status(500).json({ error: 'DB_ERROR', message: 'Failed to store workflow' });
    return;
  }

  // Loki push is best-effort; failure doesn't block response
  pushLogsToLoki(workflowId, result.input).catch((err) => {
    console.error(`Loki push failed for workflow ${workflowId}:`, err);
  });

  const viewUrl = `/workflows/${workflowId}`;
  res.status(201).json({ workflowId, viewUrl });
});

export default router;
