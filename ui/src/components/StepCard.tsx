import { useNavigate, useParams } from "react-router-dom";
import type { Step } from "../lib/types";
import StatusBadge from "./StatusBadge";
import { formatElapsed } from "../lib/format";
import { useWorkflowStore } from "../store/workflowStore";

interface Props {
  step: Step;
  parentPath: string;
}

export default function StepCard({ step, parentPath }: Props) {
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const { setLogStepPath, toggleLogPanel, logPanelOpen } = useWorkflowStore();

  const elapsed = formatElapsed(step.startTime, step.endTime);
  const hierarchyPath = parentPath ? `${parentPath}/${step.stepId}` : `/${step.stepId}`;

  function handleClick() {
    if (!step.isLeaf) {
      navigate(`/workflows/${workflowId}/steps/${step.uuid}`);
    } else {
      setLogStepPath(hierarchyPath);
      if (!logPanelOpen) toggleLogPanel();
    }
  }

  return (
    <div
      onClick={handleClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.75rem",
        background: "#1e293b",
        borderRadius: 6,
        cursor: "pointer",
        border: "1px solid #334155",
        overflow: "hidden",
      }}
    >
      <StatusBadge status={step.status} />
      <span
        style={{
          color: "#f1f5f9",
          fontSize: "0.85rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
        title={step.name}
      >
        {step.name}
      </span>
      {elapsed && (
        <span style={{ color: "#64748b", fontSize: "0.75rem", flexShrink: 0 }}>
          {elapsed}
        </span>
      )}
    </div>
  );
}
