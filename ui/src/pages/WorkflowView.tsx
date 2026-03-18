import { useEffect } from "react";
import { useParams } from "react-router-dom";
import GraphContainer from "../components/GraphContainer";
import InfoCard from "../components/InfoCard";
import { useWorkflowStore } from "../store/workflowStore";
import { useLayoutContext } from "../components/WorkflowLayout";
import type { Metadata } from "../lib/types";

export default function WorkflowView() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const setStepBreadcrumbs = useWorkflowStore((s) => s.setStepBreadcrumbs);
  const { workflow } = useLayoutContext();

  useEffect(() => {
    setStepBreadcrumbs([]);
  }, [setStepBreadcrumbs]);

  const metadata: Metadata = {
    name: workflow.name,
    uri: workflow.uri ?? undefined,
    pin: workflow.pin ?? undefined,
    startTime: workflow.startTime ?? undefined,
    endTime: workflow.endTime ?? undefined,
  };

  return (
    <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem", height: "100%" }}>
      <InfoCard metadata={metadata} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <GraphContainer workflowId={workflowId!} parentPath="" />
      </div>
    </div>
  );
}
