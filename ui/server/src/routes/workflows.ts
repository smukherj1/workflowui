import { Router, type Request, type Response } from 'express';
import { validateWorkflow } from '../lib/validation';
import { insertWorkflow, getWorkflow } from '../lib/db';

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

  const viewUrl = `/workflows/${workflowId}`;
  res.status(201).json({ workflowId, viewUrl });
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const workflow = await getWorkflow(req.params.id).catch((err) => {
    console.error('DB error fetching workflow:', err);
    return undefined;
  });

  if (workflow === undefined) {
    res.status(500).json({ error: 'DB_ERROR', message: 'Failed to fetch workflow' });
    return;
  }
  if (workflow === null) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Workflow not found' });
    return;
  }

  res.json({
    id: workflow.id,
    name: workflow.name,
    metadata: workflow.metadata,
    status: workflow.status,
    uploadedAt: workflow.uploaded_at,
    expiresAt: workflow.expires_at,
    totalSteps: workflow.total_steps,
  });
});

export default router;
