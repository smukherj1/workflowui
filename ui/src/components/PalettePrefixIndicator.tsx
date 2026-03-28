interface ActiveFilter {
  field: string;
  value: string;
}

interface Props {
  filters: ActiveFilter[];
  invalidPrefixes: string[];
  onRemove: (field: string) => void;
}

const FIELD_COLORS: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  name: { bg: "#1e3a5f", border: "#2563eb", text: "#93c5fd" },
  uri: { bg: "#1e3f2f", border: "#16a34a", text: "#86efac" },
  pin: { bg: "#3f2d1e", border: "#d97706", text: "#fcd34d" },
  path: { bg: "#3b1e4f", border: "#9333ea", text: "#d8b4fe" },
};

const DEFAULT_COLORS = { bg: "#1e3a5f", border: "#2563eb", text: "#93c5fd" };

export default function PalettePrefixIndicator({
  filters,
  invalidPrefixes,
  onRemove,
}: Props) {
  return (
    <div
      data-testid="prefix-indicator"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.5rem",
        padding: "0.4rem 1rem",
        borderBottom: "1px solid #334155",
        background: "#162032",
      }}
    >
      {filters.map(({ field, value }) => {
        const colors = FIELD_COLORS[field] ?? DEFAULT_COLORS;
        return (
          <span
            key={field}
            data-testid="prefix-pill"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              color: colors.text,
              fontSize: "0.75rem",
              padding: "0.15rem 0.4rem",
            }}
          >
            {field}: {value}
            <button
              onClick={() => onRemove(field)}
              style={{
                background: "transparent",
                border: "none",
                color: colors.text,
                cursor: "pointer",
                fontSize: "0.75rem",
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </span>
        );
      })}
      {invalidPrefixes.map((prefix) => (
        <span
          key={prefix}
          data-testid="invalid-prefix"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            background: "#3f1e1e",
            border: "1px solid #dc2626",
            borderRadius: 4,
            color: "#fca5a5",
            fontSize: "0.75rem",
            padding: "0.15rem 0.4rem",
          }}
        >
          ⚠ {prefix}
        </span>
      ))}
    </div>
  );
}
