import type { WorkflowDetail } from "../lib/types";
import StatusBadge from "./StatusBadge";
import { formatRelative } from "../lib/format";

interface Props {
  workflow: WorkflowDetail;
}

export default function WorkflowHeader({ workflow }: Props) {
  const meta = workflow.metadata ?? {};
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        padding: "0.75rem 1.25rem",
        background: "#1e293b",
        color: "#f1f5f9",
        flexWrap: "wrap",
        borderBottom: "1px solid #334155",
      }}
    >
      <StatusBadge status={workflow.status} size={14} />
      <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>
        {workflow.name}
      </span>
      {meta.repository && (
        <span
          style={{
            background: "#334155",
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: "0.8rem",
          }}
        >
          {meta.repository}
        </span>
      )}
      {meta.branch && (
        <span
          style={{
            background: "#334155",
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: "0.8rem",
          }}
        >
          {meta.branch}
        </span>
      )}
      {meta.commit && (
        <span
          style={{
            background: "#334155",
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: "0.8rem",
            fontFamily: "monospace",
          }}
        >
          {meta.commit.slice(0, 7)}
        </span>
      )}
      <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: "#94a3b8" }}>
        {formatRelative(workflow.uploadedAt)}
      </span>
    </div>
  );
}
