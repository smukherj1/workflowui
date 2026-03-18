import { Link } from "react-router-dom";
import type { WorkflowDetail } from "../lib/types";
import StatusBadge from "./StatusBadge";
import { formatRelative } from "../lib/format";

interface Props {
  workflow: WorkflowDetail;
}

export default function WorkflowHeader({ workflow }: Props) {
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
      <Link
        to="/"
        style={{
          color: "#60a5fa",
          textDecoration: "none",
          fontWeight: 700,
          fontSize: "0.9rem",
        }}
      >
        WorkflowUI
      </Link>
      <StatusBadge status={workflow.status} size={14} />
      <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>
        {workflow.name}
      </span>
      <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: "#94a3b8" }}>
        {formatRelative(workflow.uploadedAt)}
      </span>
    </div>
  );
}
