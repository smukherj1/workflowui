import { create } from "zustand";
import type { StepStatus } from "../lib/types";

interface WorkflowStore {
  statusFilter: StepStatus[];
  setStatusFilter: (statuses: StepStatus[]) => void;
  viewMode: "dagre" | "grid";
  setViewMode: (mode: "dagre" | "grid") => void;
  stepBreadcrumbs: Array<{ uuid: string; name: string }>;
  setStepBreadcrumbs: (crumbs: Array<{ uuid: string; name: string }>) => void;
}

export const useWorkflowStore = create<WorkflowStore>((set) => ({
  statusFilter: [],
  setStatusFilter: (statuses) => set({ statusFilter: statuses }),
  viewMode: "dagre",
  setViewMode: (mode) => set({ viewMode: mode }),
  stepBreadcrumbs: [],
  setStepBreadcrumbs: (crumbs) => set({ stepBreadcrumbs: crumbs }),
}));
