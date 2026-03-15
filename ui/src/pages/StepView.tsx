import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStepDetail } from "../lib/api";
import GraphContainer from "../components/GraphContainer";
import LeafDetail from "../components/LeafDetail";
import { useWorkflowStore } from "../store/workflowStore";

export default function StepView() {
  const { workflowId, uuid } = useParams<{
    workflowId: string;
    uuid: string;
  }>();
  const setStepBreadcrumbs = useWorkflowStore((s) => s.setStepBreadcrumbs);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["stepDetail", workflowId, uuid],
    queryFn: () => getStepDetail(workflowId!, uuid!),
    staleTime: Infinity,
    enabled: !!workflowId && !!uuid,
  });

  useEffect(() => {
    if (data) {
      setStepBreadcrumbs(data.breadcrumbs);
    }
  }, [data, setStepBreadcrumbs]);

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#64748b",
        }}
      >
        Loading step...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: "1rem",
          color: "#ef4444",
        }}
      >
        <span>Step not found.</span>
        <Link
          to={`/workflows/${workflowId}`}
          style={{ color: "#60a5fa" }}
        >
          Back to workflow
        </Link>
      </div>
    );
  }

  const { step } = data;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {step.isLeaf ? (
          <LeafDetail step={step} />
        ) : (
          <GraphContainer
            workflowId={workflowId!}
            parentId={uuid}
            parentPath={step.hierarchyPath}
          />
        )}
      </div>
    </div>
  );
}
