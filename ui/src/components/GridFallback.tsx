import { useState } from "react";
import type { Step, StepStatus } from "../lib/types";
import { useWorkflowStore } from "../store/workflowStore";
import StepCard from "./StepCard";

const STATUS_ORDER: StepStatus[] = [
  "failed",
  "running",
  "passed",
  "skipped",
  "cancelled",
];

interface Props {
  steps: Step[];
  parentPath: string;
}

export default function GridFallback({ steps, parentPath }: Props) {
  const [search, setSearch] = useState("");
  const { statusFilter } = useWorkflowStore();

  const filtered = steps
    .filter((s) => statusFilter.length === 0 || statusFilter.includes(s.status))
    .filter(
      (s) =>
        !search || s.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
    );

  return (
    <div
      style={{
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        height: "100%",
        overflow: "auto",
      }}
    >
      <input
        placeholder="Search steps..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 6,
          color: "#e2e8f0",
          padding: "0.4rem 0.75rem",
          fontSize: "0.875rem",
          outline: "none",
          width: "100%",
          maxWidth: 400,
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "0.5rem",
        }}
      >
        {filtered.map((step) => (
          <StepCard key={step.uuid} step={step} parentPath={parentPath} />
        ))}
      </div>
      {filtered.length === 0 && (
        <div style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}>
          No steps match the current filters.
        </div>
      )}
    </div>
  );
}
