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

// Only use page-based display for very large sets to keep DOM manageable
const PAGE_SIZE = 10_000;

interface Props {
  steps: Step[];
  parentPath: string;
}

export default function GridFallback({ steps, parentPath }: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
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

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

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
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
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
        {pageItems.map((step) => (
          <StepCard key={step.uuid} step={step} parentPath={parentPath} />
        ))}
      </div>
      {filtered.length === 0 && (
        <div style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}>
          No steps match the current filters.
        </div>
      )}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "0.5rem" }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#60a5fa",
              padding: "0.3rem 0.75rem",
              borderRadius: 4,
              cursor: safePage === 0 ? "default" : "pointer",
              opacity: safePage === 0 ? 0.5 : 1,
            }}
          >
            Previous
          </button>
          <span style={{ color: "#64748b", fontSize: "0.875rem" }}>
            Page {safePage + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage === totalPages - 1}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#60a5fa",
              padding: "0.3rem 0.75rem",
              borderRadius: 4,
              cursor: safePage === totalPages - 1 ? "default" : "pointer",
              opacity: safePage === totalPages - 1 ? 0.5 : 1,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
