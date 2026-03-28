import { forwardRef } from "react";

interface Props {
  /** Current raw text in the search input. Controlled by CommandPalette. */
  query: string;
  /** Called on every keystroke. CommandPalette uses this to update its query
   *  state and close the help panel if it was open. */
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Forwarded to the <input> for keyboard navigation (ArrowUp/Down, Enter,
   *  Escape) handled by CommandPalette. */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** When true, shows a "…" spinner beside the input to indicate a search
   *  request is in flight. */
  loading: boolean;
  /** Whether the help panel is currently visible. Used to toggle the "?"
   *  button's background so it appears active/pressed while help is open. */
  showHelp: boolean;
  /** Called when the user clicks the "?" button to show or hide the help
   *  panel. Toggles CommandPalette's showHelp state. */
  onToggleHelp: () => void;
  /** Placeholder text for the input. Differs based on whether the palette is
   *  scoped to a specific workflow ("Search steps...") or global
   *  ("Search workflows and steps..."). */
  placeholder: string;
}

/**
 * The top row of the command palette: a search icon, the text input, an
 * optional loading indicator, and the "?" help-toggle button.
 *
 * The component is a forwardRef so CommandPalette can imperatively focus the
 * input after the palette mounts (50 ms after open transitions to true).
 */
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
