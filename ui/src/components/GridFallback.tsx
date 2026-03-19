import { useState } from "react";
import type { StepStatus, StepsResponse } from "../lib/types";
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
  allPages: StepsResponse[];
  parentPath: string;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
}

export default function GridFallback({
  allPages,
  parentPath,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
}: Props) {
  const [pageIndex, setPageIndex] = useState(0);
  const [search, setSearch] = useState("");
  const { statusFilter } = useWorkflowStore();

  const isWaitingForPage = pageIndex >= allPages.length;
  const currentSteps = allPages[pageIndex]?.steps ?? [];

  const filtered = currentSteps
    .filter((s) => statusFilter.length === 0 || statusFilter.includes(s.status))
    .filter(
      (s) =>
        !search || s.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
    );

  const totalLoaded = allPages.length;
  const isOnLastLoaded = pageIndex === totalLoaded - 1;
  const canGoPrev = pageIndex > 0;
  const canGoNext = !isWaitingForPage && (!isOnLastLoaded || hasNextPage);

  const handleNext = () => {
    if (pageIndex < allPages.length - 1) {
      // Already fetched — just advance
      setPageIndex(pageIndex + 1);
    } else if (hasNextPage && !isFetchingNextPage) {
      // Optimistically advance; page data will arrive and re-render
      fetchNextPage();
      setPageIndex(pageIndex + 1);
    }
  };

  const handlePrev = () => {
    setPageIndex((i) => Math.max(0, i - 1));
  };

  if (allPages.length === 0) {
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

  const pageLabel = `Page ${pageIndex + 1} of ${totalLoaded}${hasNextPage ? "+" : ""}`;

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
      {isWaitingForPage ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            color: "#64748b",
          }}
        >
          Loading page {pageIndex + 1}...
        </div>
      ) : (
        <>
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
            <div
              style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}
            >
              No steps match the current filters.
            </div>
          )}
        </>
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
          onClick={handlePrev}
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
          {isWaitingForPage
            ? `Loading page ${pageIndex + 1}...`
            : pageLabel}
        </span>
        <button
          onClick={handleNext}
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
          {isFetchingNextPage && isOnLastLoaded ? "Loading..." : "Next"}
        </button>
      </div>
    </div>
  );
}
