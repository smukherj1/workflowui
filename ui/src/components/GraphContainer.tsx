import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { getSteps } from "../lib/api";
import { useWorkflowStore } from "../store/workflowStore";
import GraphView from "./GraphView";
import GridFallback from "./GridFallback";
import type { Step, Dependency } from "../lib/types";

// Use GridFallback (CSS grid) for step counts where dagre/ReactFlow becomes slow
const GRID_THRESHOLD = 500;

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

  const { data, isLoading, isFetchingNextPage, isError, refetch, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ["steps", workflowId, parentId ?? null],
    queryFn: ({ pageParam }) =>
      getSteps(workflowId, parentId, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading || hasNextPage) {
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
        {isLoading ? "Loading steps..." : "Loading more steps..."}
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
  const allDeps: Dependency[] =
    data?.pages.flatMap((p) => p.dependencies) ?? [];

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

  // Use "/" for root level; backend strips trailing slash to get LIKE "/%"
  const logsStepPath = parentPath || "/";
  const viewLogsUrl = `/workflows/${workflowId}/logs?stepPath=${encodeURIComponent(logsStepPath)}`;

  const useGrid = allSteps.length > GRID_THRESHOLD || viewMode === "grid";

  const visibleDeps = useGrid
    ? []
    : allDeps.filter(
        (d) =>
          filteredSteps.some((s) => s.uuid === d.from) &&
          filteredSteps.some((s) => s.uuid === d.to),
      );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "0.5rem" }}>
      <div>
        <Link to={viewLogsUrl} style={{ color: "#60a5fa", fontSize: "0.875rem", textDecoration: "none" }}>
          View Logs
        </Link>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {useGrid ? (
          <GridFallback steps={filteredSteps} parentPath={parentPath} />
        ) : (
          <GraphView
            steps={filteredSteps}
            dependencies={visibleDeps}
            parentPath={parentPath}
          />
        )}
      </div>
    </div>
  );
}
