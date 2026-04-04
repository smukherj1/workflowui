import { Link } from "react-router-dom";
import type { WorkflowDetail } from "../lib/types";
import StatusBadge from "./StatusBadge";
import { formatRelative } from "../lib/format";
import CommandPalette from "./CommandPalette";
import { useCommandPalette } from "../hooks/useCommandPalette";

interface Props {
  workflow: WorkflowDetail;
}

export default function WorkflowHeader({ workflow }: Props) {
  const { paletteOpen, openPalette, closePalette } = useCommandPalette();

  return (
    <>
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

        {/* Search trigger */}
        <button
          data-testid="search-trigger"
          onClick={openPalette}
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 6,
            padding: "0.3rem 0.75rem",
            color: "#64748b",
            fontSize: "0.8rem",
            cursor: "pointer",
          }}
        >
          🔍 Search steps or go to ID...
          <span
            style={{
              fontSize: "0.7rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 4,
              padding: "0.1rem 0.35rem",
              color: "#475569",
            }}
          >
            ⌘K
          </span>
        </button>

        <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
          {formatRelative(workflow.uploadedAt)}
        </span>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        workflowId={workflow.id}
      />
    </>
  );
}
