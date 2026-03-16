import { useEffect } from "react";
import { useParams } from "react-router-dom";
import GraphContainer from "../components/GraphContainer";
import { useWorkflowStore } from "../store/workflowStore";

export default function WorkflowView() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const setStepBreadcrumbs = useWorkflowStore((s) => s.setStepBreadcrumbs);
  const setLogStepPath = useWorkflowStore((s) => s.setLogStepPath);

  useEffect(() => {
    setStepBreadcrumbs([]);
    setLogStepPath("/");
  }, [setStepBreadcrumbs, setLogStepPath]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <GraphContainer workflowId={workflowId!} parentPath="" />
    </div>
  );
}
