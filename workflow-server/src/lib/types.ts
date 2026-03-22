export interface Metadata {
  name: string;
  uri?: string;
  pin?: string;
  startTime?: string;
  endTime?: string;
}

export interface LogEntry {
  content: string;
  timestamp?: string;
}

export interface StepInput {
  id: string;
  metadata: Metadata;
  status: string;
  dependsOn: string[];
  logs: LogEntry[] | null;
  steps: StepInput[];
}

export interface WorkflowInput {
  workflow: {
    metadata: Metadata;
    steps: StepInput[];
  };
}

export interface FlatStep {
  tempId: string; // used during processing before DB insert
  workflowId?: string;
  stepId: string;
  parentTempId: string | null;
  hierarchyPath: string;
  name: string;
  uri?: string;
  pin?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  isLeaf: boolean;
  depth: number;
  sortOrder: number;
  logs: LogEntry[] | null;
  dependsOn: string[]; // sibling step IDs
}
