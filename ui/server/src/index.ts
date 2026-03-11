import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import workflowsRouter from './routes/workflows';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.use(cors());
app.use(
  express.json({
    limit: '61mb', // Express enforces limit; route handler also checks Content-Length
  })
);

app.use('/api/workflows', workflowsRouter);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// Convert express PayloadTooLargeError to our error format
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (
    err &&
    typeof err === 'object' &&
    'type' in err &&
    (err as { type: string }).type === 'entity.too.large'
  ) {
    res.status(400).json({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Workflow JSON must be under 60 MB',
    });
    return;
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`API server listening on :${PORT}`);
});
