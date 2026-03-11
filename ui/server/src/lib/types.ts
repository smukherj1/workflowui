// Input types from JSON upload

export type StepStatus = 'passed' | 'failed' | 'running' | 'skipped' | 'cancelled';

export interface WorkflowStep {
  id: string;
  name: string;
  status: StepStatus;
  startTime?: string;
  endTime?: string;
  dependsOn: string[];
  logs?: string | null;
  steps: WorkflowStep[];
}

export interface WorkflowInput {
  workflow: {
    name: string;
    metadata?: Record<string, unknown>;
    steps: WorkflowStep[];
  };
}

// Flattened step for DB insertion
export interface FlatStep {
  uuid: string;
  stepId: string;
  parentUUID: string | null;
  hierarchyPath: string;
  name: string;
  status: string;
  startTime: Date | null;
  endTime: Date | null;
  isLeaf: boolean;
  depth: number;
  sortOrder: number;
}

export interface PendingDep {
  stepUUID: string;
  parentKey: string; // parent UUID or 'root'
  dependsOnStepId: string;
}
