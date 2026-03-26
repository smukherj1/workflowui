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

interface ParsedQuery {
  field: "name" | "uri" | "pin" | "path" | null;
  term: string;
}

function parseSearchQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();

  // Quoted query — strip outer quotes, no prefix parsing
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return { field: null, term: trimmed.slice(1, -1) };
  }

  // Check for recognized prefix at start of string
  const prefixes = ["name:", "uri:", "pin:", "path:"] as const;
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) {
      return {
        field: prefix.slice(0, -1) as ParsedQuery["field"],
        term: trimmed.slice(prefix.length).trim(),
      };
    }
  }

  // No prefix
  return { field: null, term: trimmed };
}

export default function CommandPalette({ open, onClose, workflowId }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHelpRef = useRef(false);
  const navigate = useNavigate();

  showHelpRef.current = showHelp;

  const parsed = parseSearchQuery(query);

  // Focus input and handle global Escape when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setShowHelp(false);
      setTimeout(() => inputRef.current?.focus(), 50);

      function onEsc(e: KeyboardEvent) {
        if (e.key === "Escape") {
          if (showHelpRef.current) {
            setShowHelp(false);
          } else {
            onClose();
          }
        }
      }
      window.addEventListener("keydown", onEsc);
      return () => window.removeEventListener("keydown", onEsc);
    }
  }, [open, onClose]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const { field, term } = parseSearchQuery(query);
    if (!term) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const scope = workflowId ? "steps" : "all";
        const resp = await search(term, {
          scope,
          workflowId: workflowId || undefined,
          field: field || undefined,
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
      if (showHelp) {
        setShowHelp(false);
      } else {
        onClose();
      }
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

  function handleAdvancedSearch() {
    onClose();
    const params = new URLSearchParams();
    if (parsed.term) params.set("q", parsed.term);
    if (parsed.field) params.set("field", parsed.field);
    if (workflowId) params.set("workflowId", workflowId);
    const qs = params.toString();
    navigate(`/search${qs ? `?${qs}` : ""}`);
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
            onChange={(e) => {
              setQuery(e.target.value);
              if (showHelp) setShowHelp(false);
            }}
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
          <button
            data-testid="search-help-button"
            title="Search help — supported prefixes and syntax"
            onClick={() => setShowHelp((v) => !v)}
            style={{
              background: showHelp ? "#334155" : "transparent",
              border: "1px solid #334155",
              borderRadius: 4,
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "0.75rem",
              fontWeight: 600,
              lineHeight: 1,
              padding: "0.2rem 0.45rem",
            }}
          >
            ?
          </button>
        </div>

        {/* Prefix indicator */}
        {parsed.field && !showHelp && (
          <div
            data-testid="prefix-indicator"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.4rem 1rem",
              borderBottom: "1px solid #334155",
              background: "#162032",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                background: "#1e3a5f",
                border: "1px solid #2563eb",
                borderRadius: 4,
                color: "#93c5fd",
                fontSize: "0.75rem",
                padding: "0.15rem 0.4rem",
              }}
            >
              Field: {parsed.field}
              <button
                onClick={() => setQuery(parsed.term)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#93c5fd",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </span>
            <span style={{ color: "#475569", fontSize: "0.75rem" }}>
              searching for &quot;{parsed.term}&quot;
            </span>
          </div>
        )}

        {/* Help panel or results */}
        {showHelp ? (
          <div
            data-testid="search-help-panel"
            style={{
              padding: "1rem",
              color: "#94a3b8",
              fontSize: "0.8rem",
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            <div
              style={{
                color: "#f1f5f9",
                fontWeight: 600,
                marginBottom: "0.5rem",
              }}
            >
              Search Prefixes
            </div>
            <div
              style={{
                borderTop: "1px solid #334155",
                paddingTop: "0.5rem",
                marginBottom: "1rem",
              }}
            >
              {(
                [
                  ["name:", "Search by name", "name:build"],
                  ["uri:", "Search by URI", "uri:github://org"],
                  ["pin:", "Search by pin/version", "pin:abc123"],
                  ["path:", "Search by hierarchy path", "path:/ci/build"],
                ] as [string, string, string][]
              ).map(([prefix, desc, example]) => (
                <div
                  key={prefix}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "4rem 1fr auto",
                    gap: "0.5rem",
                    padding: "0.3rem 0",
                  }}
                >
                  <span style={{ color: "#93c5fd", fontFamily: "monospace" }}>
                    {prefix}
                  </span>
                  <span>{desc}</span>
                  <span style={{ color: "#475569", fontFamily: "monospace" }}>
                    {example}
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                color: "#f1f5f9",
                fontWeight: 600,
                marginBottom: "0.5rem",
              }}
            >
              Escaping
            </div>
            <div
              style={{
                borderTop: "1px solid #334155",
                paddingTop: "0.5rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: "0.3rem 0" }}>
                Wrap in double quotes to search literally:
              </p>
              <p
                style={{
                  margin: "0.3rem 0",
                  fontFamily: "monospace",
                  color: "#475569",
                }}
              >
                &quot;name:foo&quot; searches for the text name:foo
              </p>
            </div>
            <div
              style={{
                color: "#f1f5f9",
                fontWeight: 600,
                marginBottom: "0.5rem",
              }}
            >
              Tips
            </div>
            <div
              style={{ borderTop: "1px solid #334155", paddingTop: "0.5rem" }}
            >
              <p style={{ margin: "0.3rem 0" }}>
                • No prefix searches name, URI, and pin together
              </p>
              <p style={{ margin: "0.3rem 0" }}>
                • Within a workflow, search is scoped to its steps
              </p>
              <p style={{ margin: "0.3rem 0" }}>
                • Press Esc to close, ↑↓ to navigate results
              </p>
            </div>
          </div>
        ) : (
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
                No results for &quot;{query}&quot;
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
                key={
                  result.type === "workflow" ? result.workflowId : result.uuid
                }
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
        )}

        {/* Footer */}
        <div
          style={{
            padding: "0.5rem 1rem",
            borderTop: "1px solid #1e293b",
            display: "flex",
            gap: "1rem",
            fontSize: "0.7rem",
            color: "#475569",
            alignItems: "center",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
          <span style={{ marginLeft: "auto" }}>
            <button
              data-testid="advanced-search-link"
              onClick={handleAdvancedSearch}
              style={{
                background: "transparent",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                fontSize: "0.7rem",
                padding: 0,
              }}
            >
              Advanced Search →
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
