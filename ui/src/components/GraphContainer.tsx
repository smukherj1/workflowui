import { useInfiniteQuery } from "@tanstack/react-query";
import { getSteps } from "../lib/api";
import { useWorkflowStore } from "../store/workflowStore";
import GraphView from "./GraphView";
import GridFallback from "./GridFallback";
import type { Step, Dependency } from "../lib/types";

const GRID_THRESHOLD = 10_000;

interface Props {
  workflowId: string;
  parentId?: string;
  parentPath: string;
}

export default function GraphContainer({
  workflowId,
  parentId,
  parentPath,
}: Props) {
  const { statusFilter, viewMode } = useWorkflowStore();

  const { data, isLoading, isError, refetch } = useInfiniteQuery({
    queryKey: ["steps", workflowId, parentId ?? null],
    queryFn: ({ pageParam }) =>
      getSteps(workflowId, parentId, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          color: "#64748b",
        }}
      >
        Loading steps...
      </div>
    );
  }

  if (isError) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: "1rem",
          color: "#ef4444",
        }}
      >
        <span>Failed to load steps.</span>
        <button
          onClick={() => refetch()}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            color: "#60a5fa",
            padding: "0.4rem 1rem",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const allSteps: Step[] = data?.pages.flatMap((p) => p.steps) ?? [];
  const allDeps: Dependency[] = data?.pages.flatMap((p) => p.dependencies) ?? [];

  const filteredSteps =
    statusFilter.length === 0
      ? allSteps
      : allSteps.filter((s) => statusFilter.includes(s.status));

  if (filteredSteps.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          color: "#64748b",
        }}
      >
        No steps at this level.
      </div>
    );
  }

  const useGrid = allSteps.length > GRID_THRESHOLD || viewMode === "grid";

  if (useGrid) {
    return (
      <GridFallback steps={filteredSteps} parentPath={parentPath} />
    );
  }

  const visibleDeps = allDeps.filter(
    (d) =>
      filteredSteps.some((s) => s.uuid === d.from) &&
      filteredSteps.some((s) => s.uuid === d.to),
  );

  return (
    <GraphView
      steps={filteredSteps}
      dependencies={visibleDeps}
      parentPath={parentPath}
    />
  );
}
