import { useState } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getLogs, getWorkflow } from "../lib/api";
import LogLineComponent from "../components/LogLine";

export default function LogsPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const stepPath = searchParams.get("stepPath") ?? "/";
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [prevCursors, setPrevCursors] = useState<(string | undefined)[]>([]);
  const [filter, setFilter] = useState("");

  const { data: workflow } = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: () => getWorkflow(workflowId!),
    staleTime: Infinity,
    enabled: !!workflowId,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["logs", workflowId, stepPath, cursor],
    queryFn: () => getLogs(workflowId!, stepPath, cursor),
    staleTime: 30_000,
    enabled: !!workflowId,
  });

  const lines = data?.lines ?? [];
  const filteredLines = filter
    ? lines.filter((l) => l.line.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  const pageIndex = prevCursors.length;

  function goNext() {
    if (!data?.nextCursor) return;
    setPrevCursors((p) => [...p, cursor]);
    setCursor(data.nextCursor ?? undefined);
  }

  function goPrev() {
    if (prevCursors.length === 0) return;
    const prev = [...prevCursors];
    const last = prev.pop();
    setPrevCursors(prev);
    setCursor(last);
  }

  const backUrl = `/workflows/${workflowId}`;

  return (
    <div
      data-testid="logs-page"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0f172a",
        color: "#e2e8f0",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.75rem 1.25rem",
          background: "#1e293b",
          borderBottom: "1px solid #334155",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <Link to="/" style={{ color: "#60a5fa", textDecoration: "none", fontWeight: 700, fontSize: "0.9rem" }}>
          WorkflowUI
        </Link>
        {workflow && (
          <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>{workflow.name}</span>
        )}
        <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#64748b" }}>
          {stepPath}
        </span>
        <Link
          to={backUrl}
          style={{ marginLeft: "auto", color: "#60a5fa", fontSize: "0.875rem", textDecoration: "none" }}
        >
          ← Back to workflow
        </Link>
      </div>

      {/* Filter bar */}
      <div style={{ padding: "0.5rem 1.25rem", background: "#0f172a", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
        <input
          placeholder="Filter logs..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 4,
            color: "#e2e8f0",
            padding: "0.35rem 0.75rem",
            fontSize: "0.8rem",
            outline: "none",
            width: 250,
          }}
        />
      </div>

      {/* Log content */}
      <div style={{ flex: 1, overflow: "auto", padding: "0.5rem 1.25rem" }}>
        {isLoading && (
          <div style={{ color: "#64748b", fontFamily: "monospace", fontSize: "0.8rem" }}>
            Loading logs...
          </div>
        )}
        {!isLoading && filteredLines.length === 0 && (
          <div style={{ color: "#64748b", fontFamily: "monospace", fontSize: "0.8rem" }}>
            No logs found.
          </div>
        )}
        {filteredLines.map((line, i) => (
          <LogLineComponent key={`${pageIndex}-${i}`} line={line} />
        ))}
      </div>

      {/* Pagination */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.75rem 1.25rem",
          background: "#1e293b",
          borderTop: "1px solid #334155",
          flexShrink: 0,
        }}
      >
        <button
          onClick={goPrev}
          disabled={pageIndex === 0}
          style={{
            background: "#0f172a",
            border: "1px solid #334155",
            color: "#60a5fa",
            padding: "0.3rem 0.75rem",
            borderRadius: 4,
            cursor: pageIndex === 0 ? "default" : "pointer",
            opacity: pageIndex === 0 ? 0.5 : 1,
          }}
        >
          Previous
        </button>
        <span style={{ color: "#64748b", fontSize: "0.875rem" }}>
          Page {pageIndex + 1}
        </span>
        <button
          onClick={goNext}
          disabled={!data?.nextCursor}
          style={{
            background: "#0f172a",
            border: "1px solid #334155",
            color: "#60a5fa",
            padding: "0.3rem 0.75rem",
            borderRadius: 4,
            cursor: !data?.nextCursor ? "default" : "pointer",
            opacity: !data?.nextCursor ? 0.5 : 1,
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
