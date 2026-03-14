import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useWorkflowStore } from "../store/workflowStore";
import { getLogs } from "../lib/api";
import LogLineComponent from "./LogLine";
import type { LogLine } from "../lib/types";

interface Props {
  workflowId: string;
}

export default function LogPanel({ workflowId }: Props) {
  const { logPanelOpen, toggleLogPanel, logStepPath, logFilter, setLogFilter } =
    useWorkflowStore();

  const [panelHeight, setPanelHeight] = useState(300);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stepPath = logStepPath ?? "/";

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: ["logs", workflowId, stepPath],
      queryFn: ({ pageParam }) =>
        getLogs(workflowId, stepPath, pageParam as string | undefined),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      enabled: logPanelOpen && !!workflowId,
    });

  const allLines: LogLine[] = data?.pages.flatMap((p) => p.lines) ?? [];
  const filteredLines = logFilter
    ? allLines.filter((l) =>
        l.line.toLowerCase().includes(logFilter.toLowerCase()),
      )
    : allLines;

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (scrollRef.current && !logFilter) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allLines.length, logFilter]);

  function onDragStart(e: React.MouseEvent) {
    dragRef.current = { startY: e.clientY, startH: panelHeight };
    e.preventDefault();

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      setPanelHeight(Math.max(100, Math.min(800, dragRef.current.startH + delta)));
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop - clientHeight < 50 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }

  return (
    <div
      data-testid="log-panel"
      className="log-panel"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "#0f172a",
        borderTop: "2px solid #334155",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        height: logPanelOpen ? panelHeight : 40,
        transition: logPanelOpen ? "none" : "height 0.2s",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0 1rem",
          height: 40,
          flexShrink: 0,
          borderBottom: logPanelOpen ? "1px solid #1e293b" : "none",
          cursor: "default",
        }}
      >
        {/* Drag handle — only on top edge when open */}
        {logPanelOpen && (
          <div
            onMouseDown={onDragStart}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              cursor: "ns-resize",
              background: "#334155",
            }}
          />
        )}
        <button
          onClick={toggleLogPanel}
          style={{
            background: "none",
            border: "none",
            color: "#60a5fa",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "0.25rem",
          }}
        >
          {logPanelOpen ? "▼" : "▲"} Logs
        </button>
        {logStepPath && (
          <span style={{ color: "#64748b", fontFamily: "monospace", fontSize: "0.75rem" }}>
            {logStepPath}
          </span>
        )}
        {logPanelOpen && (
          <input
            placeholder="Filter logs..."
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
            style={{
              marginLeft: "auto",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 4,
              color: "#e2e8f0",
              padding: "2px 8px",
              fontSize: "0.8rem",
              outline: "none",
              width: 200,
            }}
          />
        )}
      </div>

      {/* Log content */}
      {logPanelOpen && (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          style={{
            flex: 1,
            overflow: "auto",
            padding: "0.5rem 1rem",
          }}
        >
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
            <LogLineComponent key={i} line={line} />
          ))}
          {isFetchingNextPage && (
            <div style={{ color: "#64748b", fontFamily: "monospace", fontSize: "0.8rem" }}>
              Loading more...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
