import type { WorkflowInput, WorkflowStep } from './types';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';
const MAX_BATCH_BYTES = 2 * 1024 * 1024; // 2 MB

interface LogEntry {
  timestampNs: string;
  line: string;
  metadata: { step_path: string; step_id: string; depth: string };
}

function collectLogs(
  steps: WorkflowStep[],
  parentPath: string,
  depth: number,
  entries: LogEntry[]
): void {
  for (const step of steps) {
    const stepPath = `${parentPath}/${step.id}`;
    if (step.steps.length === 0 && step.logs) {
      const lines = step.logs.split('\n');
      const baseMs = step.startTime ? new Date(step.startTime).getTime() : Date.now();
      const baseNs = BigInt(baseMs) * 1_000_000n;
      lines.forEach((line, idx) => {
        // Skip trailing empty line from a log ending in \n
        if (line === '' && idx === lines.length - 1) return;
        entries.push({
          timestampNs: (baseNs + BigInt(idx)).toString(),
          line: line || ' ',
          metadata: { step_path: stepPath, step_id: step.id, depth: String(depth) },
        });
      });
    }
    if (step.steps.length > 0) {
      collectLogs(step.steps, stepPath, depth + 1, entries);
    }
  }
}

async function pushBatch(workflowId: string, entries: LogEntry[]): Promise<void> {
  const payload = {
    streams: [
      {
        stream: { workflow_id: workflowId },
        values: entries.map((e) => [e.timestampNs, e.line, e.metadata]),
      },
    ],
  };

  const res = await fetch(`${LOKI_URL}/loki/api/v1/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Loki push failed (${res.status}): ${text}`);
  }
}

export async function pushLogsToLoki(
  workflowId: string,
  input: WorkflowInput
): Promise<void> {
  const entries: LogEntry[] = [];
  collectLogs(input.workflow.steps, '', 1, entries);
  if (entries.length === 0) return;

  entries.sort((a, b) =>
    BigInt(a.timestampNs) < BigInt(b.timestampNs) ? -1 : 1
  );

  let batch: LogEntry[] = [];
  let batchBytes = 0;

  for (const entry of entries) {
    const entryBytes = Buffer.byteLength(JSON.stringify(entry));
    if (batchBytes + entryBytes > MAX_BATCH_BYTES && batch.length > 0) {
      await pushBatch(workflowId, batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(entry);
    batchBytes += entryBytes;
  }

  if (batch.length > 0) {
    await pushBatch(workflowId, batch);
  }
}
