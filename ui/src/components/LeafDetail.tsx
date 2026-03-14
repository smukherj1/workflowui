import { useEffect } from "react";
import type { StepDetail } from "../lib/types";
import StatusBadge from "./StatusBadge";
import { formatElapsed, formatRelative } from "../lib/format";
import { useWorkflowStore } from "../store/workflowStore";

interface Props {
  step: StepDetail;
}

export default function LeafDetail({ step }: Props) {
  const { setLogStepPath, logPanelOpen, toggleLogPanel } = useWorkflowStore();

  useEffect(() => {
    setLogStepPath(step.hierarchyPath);
    if (!logPanelOpen) toggleLogPanel();
  }, [step.hierarchyPath]);

  const elapsed = formatElapsed(step.startTime, step.endTime);

  return (
    <div
      style={{
        padding: "2rem",
        color: "#e2e8f0",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <StatusBadge status={step.status} size={14} />
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
          {step.name}
        </h2>
      </div>
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
          {[
            ["Status", step.status],
            ["Start", step.startTime ? formatRelative(step.startTime) : "—"],
            ["End", step.endTime ? formatRelative(step.endTime) : "—"],
            ["Elapsed", elapsed || "—"],
            ["Path", step.hierarchyPath],
            ["Depth", String(step.depth)],
          ].map(([label, value]) => (
            <tr key={label}>
              <td
                style={{
                  padding: "0.5rem 1rem",
                  color: "#64748b",
                  width: 100,
                  borderBottom: "1px solid #334155",
                  fontWeight: 500,
                }}
              >
                {label}
              </td>
              <td
                style={{
                  padding: "0.5rem 1rem",
                  borderBottom: "1px solid #334155",
                  fontFamily: label === "Path" ? "monospace" : "inherit",
                }}
              >
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ color: "#64748b", fontSize: "0.85rem" }}>
        Logs are shown in the panel below.
      </div>
    </div>
  );
}
