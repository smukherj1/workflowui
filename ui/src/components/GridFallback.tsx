import { useState, useEffect } from "react";
import type { Step } from "../lib/types";
import StepCard from "./StepCard";

const PAGE_SIZE = 1000;

interface Props {
  steps: Step[];
  parentPath: string;
}

export default function GridFallback({ steps, parentPath }: Props) {
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch] = useState("");

  // Reset to page 1 when steps array changes (e.g., filter toggled)
  useEffect(() => {
    setCurrentPage(1);
  }, [steps.length]);

  const filtered = search
    ? steps.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    : steps;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSteps = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  if (steps.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          color: "#64748b",
        }}
      >
        No steps at this level.
      </div>
    );
  }

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
          setCurrentPage(1);
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
        {pageSteps.map((step) => (
          <StepCard key={step.uuid} step={step} parentPath={parentPath} />
        ))}
      </div>
      {filtered.length === 0 && (
        <div
          style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}
        >
          No steps match the current filters.
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          marginTop: "0.5rem",
        }}
      >
        <button
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={!canGoPrev}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            color: "#60a5fa",
            padding: "0.3rem 0.75rem",
            borderRadius: 4,
            cursor: canGoPrev ? "pointer" : "default",
            opacity: canGoPrev ? 1 : 0.5,
          }}
        >
          Previous
        </button>
        <span style={{ color: "#64748b", fontSize: "0.875rem" }}>
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          disabled={!canGoNext}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            color: "#60a5fa",
            padding: "0.3rem 0.75rem",
            borderRadius: 4,
            cursor: canGoNext ? "pointer" : "default",
            opacity: canGoNext ? 1 : 0.5,
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
