import type {
  WorkflowDetail,
  StepsResponse,
  StepDetailResponse,
  StepLookupResponse,
  LogsResponse,
  SearchResponse,
  BreadcrumbsResponse,
} from "./types";

const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: string[],
    public summary?: string,
    public totalErrors?: number,
  ) {
    super(message);
  }
}

function extractApiError(body: Record<string, unknown>): {
  details?: string[];
  summary?: string;
  totalErrors?: number;
} {
  const result: { details?: string[]; summary?: string; totalErrors?: number } =
    {};

  if (Array.isArray(body.details)) {
    result.details = body.details.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "message" in item)
        return String((item as Record<string, unknown>).message);
      return String(item);
    });
  } else if (body.details) {
    result.details = [String(body.details)];
  } else if (body.message) {
    result.details = [String(body.message)];
  }

  if (typeof body.summary === "string") result.summary = body.summary;
  if (typeof body.totalErrors === "number")
    result.totalErrors = body.totalErrors;

  return result;
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
    const extracted = extractApiError(body);
    throw new ApiError(
      body.error || "Upload failed",
      res.status,
      extracted.details,
      extracted.summary,
      extracted.totalErrors,
    );
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
): Promise<StepsResponse> {
  const params = new URLSearchParams();
  if (parentId) params.set("parentId", parentId);
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

export async function lookupStep(uuid: string): Promise<StepLookupResponse> {
  const res = await fetch(`${API_BASE}/steps/${uuid}`);
  if (!res.ok) throw new ApiError("Step not found", res.status);
  return res.json();
}

export async function search(
  q: string | null,
  options?: {
    workflowId?: string;
    name?: string;
    uri?: string;
    pin?: string;
    path?: string;
    from?: string;
    to?: string;
    limit?: number;
  },
): Promise<SearchResponse> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (options?.workflowId) params.set("workflowId", options.workflowId);
  if (options?.name) params.set("name", options.name);
  if (options?.uri) params.set("uri", options.uri);
  if (options?.pin) params.set("pin", options.pin);
  if (options?.path) params.set("path", options.path);
  if (options?.from) params.set("from", options.from);
  if (options?.to) params.set("to", options.to);
  if (options?.limit) params.set("limit", String(options.limit));
  const res = await fetch(`${API_BASE}/search?${params}`);
  if (!res.ok) throw new ApiError("Search failed", res.status);
  return res.json();
}

export async function getBreadcrumbs(
  workflowId: string,
  stepPath: string,
): Promise<BreadcrumbsResponse> {
  const params = new URLSearchParams({ stepPath });
  const res = await fetch(
    `${API_BASE}/workflows/${workflowId}/breadcrumbs?${params}`,
  );
  if (!res.ok) throw new ApiError("Failed to fetch breadcrumbs", res.status);
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
