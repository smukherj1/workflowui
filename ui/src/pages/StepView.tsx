import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStepDetail } from "../lib/api";
import GraphContainer from "../components/GraphContainer";
import LeafDetail from "../components/LeafDetail";

export default function StepView() {
  const { workflowId, uuid } = useParams<{
    workflowId: string;
    uuid: string;
  }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["stepDetail", workflowId, uuid],
    queryFn: () => getStepDetail(workflowId!, uuid!),
    staleTime: Infinity,
    enabled: !!workflowId && !!uuid,
  });

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

  const { step, breadcrumbs } = data;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Step breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.25rem",
            padding: "0.4rem 1.25rem",
            background: "#0f172a",
            borderBottom: "1px solid #1e293b",
            fontSize: "0.8rem",
            flexWrap: "wrap",
          }}
        >
          {breadcrumbs.map((crumb, i) => (
            <span
              key={crumb.uuid}
              style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
            >
              <span style={{ color: "#475569" }}>&gt;</span>
              {i === breadcrumbs.length - 1 ? (
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
      )}

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
