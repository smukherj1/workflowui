interface Props {
  field: string;
  term: string;
  onDismiss: () => void;
}

export default function PalettePrefixIndicator({
  field,
  term,
  onDismiss,
}: Props) {
  return (
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
        Field: {field}
        <button
          onClick={onDismiss}
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
        searching for &quot;{term}&quot;
      </span>
    </div>
  );
}
