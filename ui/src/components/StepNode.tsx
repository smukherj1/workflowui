import { Handle, Position } from "reactflow";
import { useNavigate, useParams } from "react-router-dom";
import type { Step } from "../lib/types";
import StatusBadge from "./StatusBadge";
import { formatElapsed } from "../lib/format";

interface StepNodeData extends Step {
  hierarchyPath: string;
}

interface Props {
  data: StepNodeData;
}

export default function StepNode({ data }: Props) {
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();

  const elapsed = formatElapsed(data.startTime, data.endTime);
  const truncatedName =
    data.name.length > 30 ? data.name.slice(0, 30) + "…" : data.name;

  function handleClick() {
    if (!data.isLeaf) {
      navigate(`/workflows/${workflowId}/steps/${data.uuid}`);
    } else {
      navigate(`/workflows/${workflowId}/logs?stepPath=${encodeURIComponent(data.hierarchyPath)}`);
    }
  }

  const borderColor =
    data.status === "failed"
      ? "#ef4444"
      : data.status === "running"
        ? "#3b82f6"
        : "#334155";

  return (
    <div
      onClick={handleClick}
      title={data.name}
      style={{
        background: "#1e293b",
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        padding: "8px 12px",
        cursor: "pointer",
        minWidth: 160,
        maxWidth: 220,
        userSelect: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#475569" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <StatusBadge status={data.status} size={10} />
        <span
          style={{
            color: "#f1f5f9",
            fontWeight: 600,
            fontSize: "0.85rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {truncatedName}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginTop: 4,
        }}
      >
        {elapsed && (
          <span style={{ color: "#64748b", fontSize: "0.75rem" }}>{elapsed}</span>
        )}
        {data.childCount > 0 && (
          <span
            style={{
              background: "#334155",
              color: "#94a3b8",
              fontSize: "0.7rem",
              padding: "1px 5px",
              borderRadius: 10,
              marginLeft: "auto",
            }}
          >
            {data.childCount} steps
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "#475569" }} />
    </div>
  );
}
