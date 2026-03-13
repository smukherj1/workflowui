import type { WorkflowInput, WorkflowStep } from "./types";

const LOKI_URL = process.env.LOKI_URL ?? "http://localhost:3100";
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
  entries: LogEntry[],
  nowNs: bigint,
  counter: { value: bigint },
): void {
  for (const step of steps) {
    const stepPath = `${parentPath}/${step.id}`;
    if (step.steps.length === 0 && step.logs) {
      const lines = step.logs.split("\n");
      lines.forEach((line, idx) => {
        // Skip trailing empty line from a log ending in \n
        if (line === "" && idx === lines.length - 1) return;
        // Use current time + monotonic counter so Loki doesn't reject old timestamps.
        // Original execution timestamps are stored in the database.
        entries.push({
          timestampNs: (nowNs + counter.value).toString(),
          line: line || " ",
          metadata: {
            step_path: stepPath,
            step_id: step.id,
            depth: String(depth),
          },
        });
        counter.value += 1n;
      });
    }
    if (step.steps.length > 0) {
      collectLogs(step.steps, stepPath, depth + 1, entries, nowNs, counter);
    }
  }
}

async function pushBatch(
  workflowId: string,
  entries: LogEntry[],
): Promise<void> {
  const payload = {
    streams: [
      {
        stream: { workflow_id: workflowId },
        values: entries.map((e) => [e.timestampNs, e.line, e.metadata]),
      },
    ],
  };

  console.log(
    `Loki logs push: workflow_id=${workflowId} payload=${JSON.stringify(payload)}`,
  );

  const res = await fetch(`${LOKI_URL}/loki/api/v1/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Loki push failed (${res.status}): ${text}`);
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

export interface LogLine {
  timestampNs: string;
  line: string;
  stepPath: string;
  stepId: string;
  depth: string;
}

interface LokiQueryResponse {
  data: {
    result: Array<{
      stream: Record<string, string>;
      values: Array<[string, string, Record<string, string>?]>;
    }>;
  };
}

export async function queryLogs(
  workflowId: string,
  stepPath: string,
  limit: number,
  cursor: string | null,
): Promise<{ lines: LogLine[]; nextCursor: string | null }> {
  // step_path is structured metadata (not a stream label), so it must be
  // filtered using a label filter after the stream selector, not inside {}.
  const escapedPath = stepPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const logql = `{workflow_id="${workflowId}"} | step_path=~"${escapedPath}(/.*)?$"`;

  // Default start: 7 days ago (matches workflow retention period)
  const sevenDaysNs = BigInt(7 * 24 * 60 * 60 * 1000) * 1_000_000n;
  let startNs = String(BigInt(Date.now()) * 1_000_000n - sevenDaysNs);
  if (cursor) {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    startNs = String(BigInt(decoded) + 1n);
  }
  // end = now + 1 minute to account for clock skew
  const endNs = String(BigInt(Date.now()) * 1_000_000n + 60_000_000_000n);

  const params = new URLSearchParams({
    query: logql,
    limit: String(Math.min(limit, 1000)),
    direction: "forward",
    start: startNs,
    end: endNs,
  });

  console.log(
    `Loki logs query: GET ${LOKI_URL}/loki/api/v1/query_range?${params}`,
  );
  const res = await fetch(`${LOKI_URL}/loki/api/v1/query_range?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Loki query failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as LokiQueryResponse;
  const lines: LogLine[] = [];

  for (const stream of data.data.result) {
    // Loki promotes structured metadata into stream labels in query results
    const stepPathLabel = stream.stream.step_path ?? "";
    const stepIdLabel = stream.stream.step_id ?? "";
    const depthLabel = stream.stream.depth ?? "0";

    for (const value of stream.values) {
      const [tsNs, line] = value;
      lines.push({
        timestampNs: tsNs,
        line,
        stepPath: stepPathLabel,
        stepId: stepIdLabel,
        depth: depthLabel,
      });
    }
  }

  lines.sort((a, b) =>
    BigInt(a.timestampNs) < BigInt(b.timestampNs) ? -1 : 1,
  );

  const nextCursor =
    lines.length > 0
      ? Buffer.from(lines[lines.length - 1].timestampNs).toString("base64url")
      : null;

  return { lines, nextCursor };
}

// ── Push ──────────────────────────────────────────────────────────────────────

export async function pushLogsToLoki(
  workflowId: string,
  input: WorkflowInput,
): Promise<void> {
  const entries: LogEntry[] = [];
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  collectLogs(input.workflow.steps, "", 1, entries, nowNs, { value: 0n });
  if (entries.length === 0) return;

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
