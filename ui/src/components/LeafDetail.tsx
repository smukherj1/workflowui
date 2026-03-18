import { Link } from "react-router-dom";
import type { StepDetail } from "../lib/types";
import StatusBadge from "./StatusBadge";

interface Props {
  step: StepDetail;
  workflowId: string;
}

export default function LeafDetail({ step, workflowId }: Props) {
  const logsUrl = `/workflows/${workflowId}/logs?stepPath=${encodeURIComponent(step.hierarchyPath)}`;

  return (
    <div
      style={{
        color: "#e2e8f0",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          fontSize: "0.875rem",
          background: "#1e293b",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "0.5rem 1rem", color: "#64748b", width: 100, borderBottom: "1px solid #334155", fontWeight: 500 }}>
              Status
            </td>
            <td style={{ padding: "0.5rem 1rem", borderBottom: "1px solid #334155" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <StatusBadge status={step.status} size={10} />
                {step.status}
              </div>
            </td>
          </tr>
          <tr>
            <td style={{ padding: "0.5rem 1rem", color: "#64748b", borderBottom: "1px solid #334155", fontWeight: 500 }}>
              Path
            </td>
            <td style={{ padding: "0.5rem 1rem", borderBottom: "1px solid #334155", fontFamily: "monospace" }}>
              {step.hierarchyPath}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "0.5rem 1rem", color: "#64748b", fontWeight: 500 }}>
              Depth
            </td>
            <td style={{ padding: "0.5rem 1rem" }}>
              {step.depth}
            </td>
          </tr>
        </tbody>
      </table>
      <Link
        to={logsUrl}
        style={{
          display: "inline-block",
          background: "#3b82f6",
          color: "#fff",
          textDecoration: "none",
          padding: "0.5rem 1rem",
          borderRadius: 6,
          fontWeight: 600,
          fontSize: "0.875rem",
          alignSelf: "flex-start",
        }}
      >
        View Logs
      </Link>
    </div>
  );
}
