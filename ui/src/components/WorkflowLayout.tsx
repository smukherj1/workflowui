import { Outlet, useParams, useOutletContext, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getWorkflow } from "../lib/api";
import WorkflowHeader from "./WorkflowHeader";
import StatusFilterBar from "./StatusFilterBar";
import Breadcrumbs from "./Breadcrumbs";
import { useWorkflowStore } from "../store/workflowStore";
import type { WorkflowDetail } from "../lib/types";

interface LayoutContext {
  workflow: WorkflowDetail;
}

export function useLayoutContext() {
  return useOutletContext<LayoutContext>();
}

export default function WorkflowLayout() {
  const { workflowId } = useParams<{ workflowId: string }>();

  const {
    data: workflow,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: () => getWorkflow(workflowId!),
    staleTime: Infinity,
    enabled: !!workflowId,
  });

  const stepBreadcrumbs = useWorkflowStore((s) => s.stepBreadcrumbs);
  const isGridMode = useWorkflowStore((s) => s.isGridMode);
  const isAtWorkflowLevel = stepBreadcrumbs.length === 0;

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0f172a",
          color: "#64748b",
        }}
      >
        Loading workflow...
      </div>
    );
  }

  if (isError || !workflow) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0f172a",
          color: "#f1f5f9",
          gap: "1rem",
        }}
      >
        <h2>Workflow not found</h2>
        <Link to="/" style={{ color: "#60a5fa" }}>
          Upload a new workflow
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0f172a",
        overflow: "hidden",
      }}
    >
      <WorkflowHeader workflow={workflow} />
      <Breadcrumbs
        data-testid="breadcrumb-nav"
        items={[
          {
            label: workflow.name,
            href: isAtWorkflowLevel ? undefined : `/workflows/${workflowId}`,
          },
          ...stepBreadcrumbs.map((crumb, i) => ({
            label: crumb.name,
            href:
              i < stepBreadcrumbs.length - 1
                ? `/workflows/${workflowId}/steps/${crumb.uuid}`
                : undefined,
          })),
        ]}
      />
      {isGridMode && <StatusFilterBar />}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <Outlet context={{ workflow } satisfies LayoutContext} />
      </div>
    </div>
  );
}
