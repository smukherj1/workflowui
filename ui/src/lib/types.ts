export type StepStatus = "passed" | "failed" | "running" | "skipped" | "cancelled";

export interface Metadata {
  name: string;
  uri?: string;
  pin?: string;
  startTime?: string;
  endTime?: string;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  uri?: string;
  pin?: string;
  startTime?: string;
  endTime?: string;
  status: StepStatus;
  totalSteps: number;
  uploadedAt: string;
  expiresAt: string;
}

export interface Step {
  uuid: string;
  stepId: string;
  name: string;
  uri?: string;
  pin?: string;
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

export interface StepLookupResponse extends StepDetailResponse {
  workflowId: string;
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
