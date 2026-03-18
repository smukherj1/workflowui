import type { Metadata } from "../lib/types";
import { formatElapsed, formatLocalTime } from "../lib/format";

interface Props {
  metadata: Metadata;
}

export default function InfoCard({ metadata }: Props) {
  const elapsed = formatElapsed(metadata.startTime, metadata.endTime);

  return (
    <div
      style={{
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: 8,
        padding: "1rem 1.25rem",
        marginBottom: "1rem",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#f1f5f9", marginBottom: "0.5rem" }}>
        {metadata.name}
      </div>
      {(metadata.uri || metadata.pin || metadata.startTime || metadata.endTime || elapsed) && (
        <table style={{ borderCollapse: "collapse", fontSize: "0.875rem", width: "100%" }}>
          <tbody>
            {metadata.uri && (
              <tr>
                <td style={{ color: "#64748b", paddingRight: "1rem", paddingBottom: "0.25rem", whiteSpace: "nowrap" }}>URI</td>
                <td style={{ color: "#e2e8f0", fontFamily: "monospace", paddingBottom: "0.25rem" }}>{metadata.uri}</td>
              </tr>
            )}
            {metadata.pin && (
              <tr>
                <td style={{ color: "#64748b", paddingRight: "1rem", paddingBottom: "0.25rem", whiteSpace: "nowrap" }}>Pin</td>
                <td style={{ color: "#e2e8f0", fontFamily: "monospace", paddingBottom: "0.25rem" }}>{metadata.pin}</td>
              </tr>
            )}
            {metadata.startTime && (
              <tr>
                <td style={{ color: "#64748b", paddingRight: "1rem", paddingBottom: "0.25rem", whiteSpace: "nowrap" }}>Start Time</td>
                <td style={{ color: "#e2e8f0", paddingBottom: "0.25rem" }}>{formatLocalTime(metadata.startTime)}</td>
              </tr>
            )}
            {metadata.endTime && (
              <tr>
                <td style={{ color: "#64748b", paddingRight: "1rem", paddingBottom: "0.25rem", whiteSpace: "nowrap" }}>End Time</td>
                <td style={{ color: "#e2e8f0", paddingBottom: "0.25rem" }}>{formatLocalTime(metadata.endTime)}</td>
              </tr>
            )}
            {elapsed && (
              <tr>
                <td style={{ color: "#64748b", paddingRight: "1rem", whiteSpace: "nowrap" }}>Duration</td>
                <td style={{ color: "#e2e8f0" }}>{elapsed}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
