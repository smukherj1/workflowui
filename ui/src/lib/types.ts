export type StepStatus = "passed" | "failed" | "running" | "skipped" | "cancelled";

export interface WorkflowDetail {
  id: string;
  name: string;
  metadata: Record<string, string>;
  status: StepStatus;
  totalSteps: number;
  uploadedAt: string;
  expiresAt: string;
}

export interface Step {
  uuid: string;
  stepId: string;
  name: string;
  status: StepStatus;
  startTime: string | null;
  endTime: string | null;
  isLeaf: boolean;
  childCount: number;
}

export interface Dependency {
  from: string;
  to: string;
}

export interface StepsResponse {
  steps: Step[];
  dependencies: Dependency[];
  nextCursor: string | null;
}

export interface StepDetail extends Step {
  hierarchyPath: string;
  depth: number;
}

export interface StepDetailResponse {
  step: StepDetail;
  breadcrumbs: Array<{ uuid: string; name: string }>;
}

export interface LogLine {
  timestampNs: string;
  line: string;
  stepPath: string;
  stepId: string;
  depth: string;
}

export interface LogsResponse {
  lines: LogLine[];
  nextCursor: string | null;
}
