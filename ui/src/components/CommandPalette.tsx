import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { search } from "../lib/api";
import type { SearchResult } from "../lib/types";
import StatusBadge from "./StatusBadge";

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, default scope is "steps" within this workflow */
  workflowId?: string;
}

export default function CommandPalette({ open, onClose, workflowId }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  // Focus input and handle global Escape when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);

      function onEsc(e: KeyboardEvent) {
        if (e.key === "Escape") onClose();
      }
      window.addEventListener("keydown", onEsc);
      return () => window.removeEventListener("keydown", onEsc);
    }
  }, [open, onClose]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const scope = workflowId ? "steps" : "all";
        const resp = await search(query.trim(), {
          scope,
          workflowId: workflowId || undefined,
        });
        setResults(resp.results);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, [query, open, workflowId]);

  const navigateToResult = useCallback(
    (result: SearchResult) => {
      onClose();
      if (result.type === "workflow") {
        navigate(`/workflows/${result.workflowId}`);
      } else {
        navigate(`/workflows/${result.workflowId}/steps/${result.uuid}`);
      }
    },
    [navigate, onClose],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      navigateToResult(results[selectedIndex]);
    }
  }

  if (!open) return null;

  const placeholder = workflowId
    ? "Search steps..."
    : "Search workflows and steps...";

  return (
    <div
      data-testid="command-palette-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
      }}
    >
      <div
        data-testid="command-palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 8,
          width: 540,
          maxWidth: "90vw",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.75rem 1rem",
            borderBottom: "1px solid #334155",
          }}
        >
          <span style={{ color: "#475569", fontSize: "1rem" }}>🔍</span>
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#f1f5f9",
              fontSize: "1rem",
            }}
          />
          {loading && (
            <span style={{ color: "#475569", fontSize: "0.75rem" }}>…</span>
          )}
        </div>

        {/* Results */}
        <div style={{ maxHeight: 360, overflowY: "auto" }}>
          {results.length === 0 && query.trim() && !loading && (
            <div
              style={{
                padding: "1.5rem 1rem",
                color: "#475569",
                fontSize: "0.875rem",
                textAlign: "center",
              }}
            >
              No results for "{query}"
            </div>
          )}
          {results.length === 0 && !query.trim() && (
            <div
              style={{
                padding: "1.5rem 1rem",
                color: "#475569",
                fontSize: "0.875rem",
                textAlign: "center",
              }}
            >
              {workflowId
                ? "Type to search steps in this workflow"
                : "Type to search workflows and steps"}
            </div>
          )}
          {results.map((result, i) => (
            <div
              key={result.type === "workflow" ? result.workflowId : result.uuid}
              data-testid="search-result"
              onClick={() => navigateToResult(result)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.6rem 1rem",
                cursor: "pointer",
                background: i === selectedIndex ? "#0f172a" : "transparent",
                borderBottom: "1px solid #1e293b",
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <StatusBadge status={result.status} size={10} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: "#f1f5f9",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {result.name}
                </div>
                <div
                  style={{
                    color: "#64748b",
                    fontSize: "0.75rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {result.type === "step"
                    ? `${result.workflowName} • ${result.hierarchyPath}`
                    : (result.uri ?? result.pin ?? "workflow")}
                </div>
              </div>
              <span
                style={{
                  fontSize: "0.7rem",
                  color: "#475569",
                  flexShrink: 0,
                  background: "#0f172a",
                  padding: "0.1rem 0.4rem",
                  borderRadius: 4,
                }}
              >
                {result.type}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "0.5rem 1rem",
            borderTop: "1px solid #1e293b",
            display: "flex",
            gap: "1rem",
            fontSize: "0.7rem",
            color: "#475569",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
