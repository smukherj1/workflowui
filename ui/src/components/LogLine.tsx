import type { LogLine as LogLineType } from "../lib/types";

interface Props {
  line: LogLineType;
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

export default function LogLine({ line }: Props) {
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
      <span style={{ color: "#e2e8f0", flex: 1 }}>{line.line}</span>
    </div>
  );
}
