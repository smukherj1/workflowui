import type { StepStatus } from "../lib/types";

const statusStyles: Record<StepStatus, { bg: string; label: string }> = {
  passed: { bg: "#22c55e", label: "passed" },
  failed: { bg: "#ef4444", label: "failed" },
  running: { bg: "#3b82f6", label: "running" },
  skipped: { bg: "#9ca3af", label: "skipped" },
  cancelled: { bg: "#eab308", label: "cancelled" },
};

interface Props {
  status: StepStatus;
  size?: number;
}

export default function StatusBadge({ status, size = 10 }: Props) {
  const { bg, label } = statusStyles[status] ?? {
    bg: "#9ca3af",
    label: status,
  };
  return (
    <span
      title={label}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: bg,
        flexShrink: 0,
      }}
    />
  );
}
