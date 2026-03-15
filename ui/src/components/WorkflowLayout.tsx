import { Outlet, useParams, Link, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getWorkflow } from "../lib/api";
import WorkflowHeader from "./WorkflowHeader";
import StatusFilterBar from "./StatusFilterBar";
import LogPanel from "./LogPanel";
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
      {/* Unified breadcrumb bar */}
      <nav
        data-testid="breadcrumb-nav"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.25rem",
          padding: "0.5rem 1.25rem",
          background: "#0f172a",
          borderBottom: "1px solid #1e293b",
          fontSize: "0.85rem",
          flexWrap: "wrap",
        }}
      >
        {isAtWorkflowLevel ? (
          <span style={{ color: "#e2e8f0" }}>{workflow.name}</span>
        ) : (
          <Link
            to={`/workflows/${workflowId}`}
            style={{ color: "#60a5fa", textDecoration: "none" }}
          >
            {workflow.name}
          </Link>
        )}
        {stepBreadcrumbs.map((crumb, i) => (
          <span
            key={crumb.uuid}
            style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
          >
            <span style={{ color: "#475569" }}>&gt;</span>
            {i === stepBreadcrumbs.length - 1 ? (
              <span style={{ color: "#e2e8f0" }}>{crumb.name}</span>
            ) : (
              <Link
                to={`/workflows/${workflowId}/steps/${crumb.uuid}`}
                style={{ color: "#60a5fa", textDecoration: "none" }}
              >
                {crumb.name}
              </Link>
            )}
          </span>
        ))}
      </nav>
      <StatusFilterBar />
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <Outlet context={{ workflow } satisfies LayoutContext} />
      </div>
      <LogPanel workflowId={workflowId!} />
    </div>
  );
}
