import type { StepStatus } from "../lib/types";
import { useWorkflowStore } from "../store/workflowStore";

const ALL_STATUSES: StepStatus[] = [
  "passed",
  "failed",
  "running",
  "skipped",
  "cancelled",
];

const statusColors: Record<StepStatus, string> = {
  passed: "#22c55e",
  failed: "#ef4444",
  running: "#3b82f6",
  skipped: "#9ca3af",
  cancelled: "#eab308",
};

export default function StatusFilterBar() {
  const { statusFilter, setStatusFilter } = useWorkflowStore();

  function toggle(status: StepStatus) {
    if (statusFilter.includes(status)) {
      setStatusFilter(statusFilter.filter((s) => s !== status));
    } else {
      setStatusFilter([...statusFilter, status]);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        padding: "0.5rem 1.25rem",
        background: "#0f172a",
        borderBottom: "1px solid #1e293b",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <span style={{ color: "#64748b", fontSize: "0.8rem" }}>Filter:</span>
      {ALL_STATUSES.map((status) => {
        const active =
          statusFilter.length === 0 || statusFilter.includes(status);
        return (
          <label
            key={status}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
              cursor: "pointer",
              opacity: active ? 1 : 0.4,
              fontSize: "0.8rem",
              color: "#e2e8f0",
            }}
          >
            <input
              type="checkbox"
              checked={statusFilter.length === 0 || statusFilter.includes(status)}
              onChange={() => toggle(status)}
              style={{ accentColor: statusColors[status] }}
            />
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: statusColors[status],
              }}
            />
            {status}
          </label>
        );
      })}
      {statusFilter.length > 0 && (
        <button
          onClick={() => setStatusFilter([])}
          style={{
            marginLeft: "auto",
            background: "none",
            border: "none",
            color: "#60a5fa",
            cursor: "pointer",
            fontSize: "0.8rem",
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
