import { useNavigate } from "react-router-dom";
import type { SearchResult } from "../lib/types";
import StatusBadge from "./StatusBadge";
import { formatLocalTime } from "../lib/format";

interface Props {
  results: SearchResult[];
  isLoading: boolean;
  hasQuery: boolean;
}

export default function SearchResultsTable({
  results,
  isLoading,
  hasQuery,
}: Props) {
  const navigate = useNavigate();

  function handleRowClick(result: SearchResult) {
    if (result.type === "workflow") {
      navigate(`/workflows/${result.workflowId}`);
    } else {
      navigate(`/workflows/${result.workflowId}/steps/${result.uuid}`);
    }
  }

  if (!hasQuery) {
    return null;
  }

  if (isLoading) {
    return (
      <div
        style={{
          color: "#475569",
          fontSize: "0.875rem",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        Searching…
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div
        data-testid="search-empty"
        style={{
          color: "#475569",
          fontSize: "0.875rem",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        No results found.
      </div>
    );
  }

  return (
    <table
      data-testid="search-results-table"
      style={{
        borderCollapse: "collapse",
        width: "100%",
        fontSize: "0.875rem",
      }}
    >
      <thead>
        <tr style={{ borderBottom: "1px solid #334155" }}>
          {["Type", "Status", "Name", "Location", "Start Time"].map((h) => (
            <th
              key={h}
              style={{
                color: "#64748b",
                fontSize: "0.75rem",
                fontWeight: 500,
                padding: "0.5rem 0.75rem",
                textAlign: "left",
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {results.map((result) => {
          const key =
            result.type === "workflow" ? result.workflowId : result.uuid;
          const location =
            result.type === "workflow"
              ? (result.uri ?? result.pin ?? "—")
              : result.hierarchyPath;
          return (
            <tr
              key={key}
              onClick={() => handleRowClick(result)}
              style={{
                borderBottom: "1px solid #1e293b",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background =
                  "#1e293b";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background =
                  "transparent";
              }}
            >
              <td style={{ padding: "0.6rem 0.75rem" }}>
                <span
                  style={{
                    background:
                      result.type === "workflow" ? "#1e3a5f" : "#1a2e1a",
                    border: `1px solid ${result.type === "workflow" ? "#2563eb" : "#16a34a"}`,
                    borderRadius: 4,
                    color: result.type === "workflow" ? "#93c5fd" : "#86efac",
                    fontSize: "0.7rem",
                    padding: "0.1rem 0.4rem",
                  }}
                >
                  {result.type}
                </span>
              </td>
              <td style={{ padding: "0.6rem 0.75rem" }}>
                <StatusBadge status={result.status} size={10} />
              </td>
              <td
                style={{
                  color: "#f1f5f9",
                  fontWeight: 500,
                  maxWidth: 200,
                  overflow: "hidden",
                  padding: "0.6rem 0.75rem",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {result.name}
              </td>
              <td
                style={{
                  color: "#64748b",
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  maxWidth: 240,
                  overflow: "hidden",
                  padding: "0.6rem 0.75rem",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {location}
              </td>
              <td
                style={{
                  color: "#64748b",
                  fontSize: "0.8rem",
                  padding: "0.6rem 0.75rem",
                  whiteSpace: "nowrap",
                }}
              >
                {result.startTime ? formatLocalTime(result.startTime) : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
