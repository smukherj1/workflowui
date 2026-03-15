import { create } from "zustand";
import type { StepStatus } from "../lib/types";

interface WorkflowStore {
  logPanelOpen: boolean;
  toggleLogPanel: () => void;
  logStepPath: string | null;
  setLogStepPath: (path: string | null) => void;
  logFilter: string;
  setLogFilter: (filter: string) => void;
  statusFilter: StepStatus[];
  setStatusFilter: (statuses: StepStatus[]) => void;
  viewMode: "dagre" | "grid";
  setViewMode: (mode: "dagre" | "grid") => void;
  stepBreadcrumbs: Array<{ uuid: string; name: string }>;
  setStepBreadcrumbs: (crumbs: Array<{ uuid: string; name: string }>) => void;
}

export const useWorkflowStore = create<WorkflowStore>((set) => ({
  logPanelOpen: false,
  toggleLogPanel: () => set((s) => ({ logPanelOpen: !s.logPanelOpen })),
  logStepPath: null,
  setLogStepPath: (path) => set({ logStepPath: path }),
  logFilter: "",
  setLogFilter: (filter) => set({ logFilter: filter }),
  statusFilter: [],
  setStatusFilter: (statuses) => set({ statusFilter: statuses }),
  viewMode: "dagre",
  setViewMode: (mode) => set({ viewMode: mode }),
  stepBreadcrumbs: [],
  setStepBreadcrumbs: (crumbs) => set({ stepBreadcrumbs: crumbs }),
}));
