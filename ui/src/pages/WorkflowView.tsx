import { useParams } from "react-router-dom";
import GraphContainer from "../components/GraphContainer";

export default function WorkflowView() {
  const { workflowId } = useParams<{ workflowId: string }>();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <GraphContainer
        workflowId={workflowId!}
        parentPath=""
      />
    </div>
  );
}
