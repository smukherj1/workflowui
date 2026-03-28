interface Props {
  onAdvancedSearch: () => void;
}

export default function PaletteFooter({ onAdvancedSearch }: Props) {
  return (
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
          onClick={onAdvancedSearch}
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
  );
}
