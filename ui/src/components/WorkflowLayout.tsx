import { Outlet, useParams, Link, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getWorkflow } from "../lib/api";
import WorkflowHeader from "./WorkflowHeader";
import StatusFilterBar from "./StatusFilterBar";
import LogPanel from "./LogPanel";
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
      {/* Workflow name breadcrumb — always a link back to top-level */}
      <nav
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
        <Link
          to={`/workflows/${workflowId}`}
          style={{ color: "#60a5fa", textDecoration: "none" }}
        >
          {workflow.name}
        </Link>
      </nav>
      <StatusFilterBar />
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <Outlet context={{ workflow } satisfies LayoutContext} />
      </div>
      <LogPanel workflowId={workflowId!} />
    </div>
  );
}
