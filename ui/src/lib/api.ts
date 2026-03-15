import type {
  WorkflowDetail,
  StepsResponse,
  StepDetailResponse,
  LogsResponse,
} from "./types";

const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: string[],
  ) {
    super(message);
  }
}

export async function uploadWorkflow(
  file: File,
): Promise<{ workflowId: string; viewUrl: string }> {
  console.log(`Uploading file ${file.name} (${file.size} bytes).`);
  const text = await file.text();
  const res = await fetch(`${API_BASE}/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  console.log(`Upload file ${file.name} completed with status ${res.status}.`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Upload failed" }));
    const details = Array.isArray(body.details)
      ? body.details
      : body.details
        ? [String(body.details)]
        : body.message
          ? [body.message]
          : undefined;
    throw new ApiError(body.error || "Upload failed", res.status, details);
  }
  return res.json();
}

export async function getWorkflow(id: string): Promise<WorkflowDetail> {
  const res = await fetch(`${API_BASE}/workflows/${id}`);
  if (!res.ok) throw new ApiError("Workflow not found", res.status);
  return res.json();
}

export async function getSteps(
  workflowId: string,
  parentId?: string,
  cursor?: string,
): Promise<StepsResponse> {
  const params = new URLSearchParams();
  if (parentId) params.set("parentId", parentId);
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(
    `${API_BASE}/workflows/${workflowId}/steps?${params}`,
  );
  if (!res.ok) throw new ApiError("Failed to fetch steps", res.status);
  return res.json();
}

export async function getStepDetail(
  workflowId: string,
  uuid: string,
): Promise<StepDetailResponse> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/steps/${uuid}`);
  if (!res.ok) throw new ApiError("Step not found", res.status);
  return res.json();
}

export async function getLogs(
  workflowId: string,
  stepPath: string,
  cursor?: string,
  limit?: number,
): Promise<LogsResponse> {
  const params = new URLSearchParams({ stepPath });
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/logs?${params}`);
  if (!res.ok) throw new ApiError("Failed to fetch logs", res.status);
  return res.json();
}
