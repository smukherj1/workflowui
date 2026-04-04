import type { SearchResult } from "../lib/types";
import StatusBadge from "./StatusBadge";

interface Props {
  results: SearchResult[];
  query: string;
  loading: boolean;
  selectedIndex: number;
  onSelect: (result: SearchResult) => void;
  onHover: (index: number) => void;
  workflowId?: string;
  /** When set, replaces the default "No results" message. */
  emptyMessage?: string;
}

export default function PaletteResultsList({
  results,
  query,
  loading,
  selectedIndex,
  onSelect,
  onHover,
  workflowId,
  emptyMessage,
}: Props) {
  return (
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
          {emptyMessage ?? <>No results for &quot;{query}&quot;</>}
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
          onClick={() => onSelect(result)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.6rem 1rem",
            cursor: "pointer",
            background: i === selectedIndex ? "#0f172a" : "transparent",
            borderBottom: "1px solid #1e293b",
          }}
          onMouseEnter={() => onHover(i)}
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
  );
}
