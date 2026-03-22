import type { LogLine as LogLineType } from "../lib/types";

interface Props {
  line: LogLineType;
  showTimestamp: boolean;
}

const stepColors = [
  "#60a5fa",
  "#34d399",
  "#f59e0b",
  "#a78bfa",
  "#f472b6",
  "#38bdf8",
];

const stepColorMap = new Map<string, string>();
let colorIndex = 0;

function getStepColor(stepId: string): string {
  if (!stepColorMap.has(stepId)) {
    stepColorMap.set(stepId, stepColors[colorIndex % stepColors.length]);
    colorIndex++;
  }
  return stepColorMap.get(stepId)!;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

export default function LogLine({ line, showTimestamp }: Props) {
  const color = getStepColor(line.stepId);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.5rem",
        fontFamily: "monospace",
        fontSize: "0.8rem",
        lineHeight: "1.4",
        padding: "1px 0",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {showTimestamp && (
        <span
          style={{
            color: "#64748b",
            flexShrink: 0,
            minWidth: 140,
            whiteSpace: "nowrap",
          }}
        >
          {line.timestamp ? formatTimestamp(line.timestamp) : ""}
        </span>
      )}
      <span
        style={{
          color,
          flexShrink: 0,
          minWidth: 80,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={line.stepPath}
      >
        [{line.stepId}]
      </span>
      <span style={{ color: "#e2e8f0", flex: 1 }}>{line.content}</span>
    </div>
  );
}
