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
  ) {
    super(message);
  }
}

function extractDetails(body: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(body.details)) {
    return body.details.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "message" in item) {
        return String((item as Record<string, unknown>).message);
      }
      return String(item);
    });
  }
  if (body.details) {
    return [String(body.details)];
  }
  if (body.message) {
    return [String(body.message)];
  }
  return undefined;
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
    throw new ApiError(
      body.error || "Upload failed",
      res.status,
      extractDetails(body),
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
    scope?: "workflows" | "steps" | "all";
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
  if (options?.scope) params.set("scope", options.scope);
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
