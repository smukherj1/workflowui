import { forwardRef } from "react";

interface Props {
  query: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  loading: boolean;
  showHelp: boolean;
  onToggleHelp: () => void;
  placeholder: string;
}

const PaletteSearchInput = forwardRef<HTMLInputElement, Props>(
  function PaletteSearchInput(
    {
      query,
      onChange,
      onKeyDown,
      loading,
      showHelp,
      onToggleHelp,
      placeholder,
    },
    ref,
  ) {
    return (
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
          ref={ref}
          data-testid="command-palette-input"
          value={query}
          onChange={onChange}
          onKeyDown={onKeyDown}
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
          onClick={onToggleHelp}
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
    );
  },
);

export default PaletteSearchInput;
