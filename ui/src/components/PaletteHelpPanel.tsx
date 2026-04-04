/**
 * A reference panel that replaces the results list when the user clicks the
 * "?" button. Documents the four supported search prefixes (name/uri/pin/path),
 * the double-quote escaping syntax (to bypass prefix parsing and search
 * literally), how to combine multiple prefix filters in a single query, and
 * general tips. No props — the content is static.
 *
 * Dismissed by clicking "?" again or pressing Escape, both of which toggle
 * CommandPalette's showHelp state. Typing in the input also closes the panel.
 */
export default function PaletteHelpPanel() {
  return (
    <div
      data-testid="search-help-panel"
      style={{
        padding: "1rem",
        color: "#94a3b8",
        fontSize: "0.8rem",
        maxHeight: 360,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          color: "#f1f5f9",
          fontWeight: 600,
          marginBottom: "0.5rem",
        }}
      >
        Search Prefixes
      </div>
      <div
        style={{
          borderTop: "1px solid #334155",
          paddingTop: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        {(
          [
            ["name:", "Search by name", "name:build"],
            ["uri:", "Search by URI", "uri:github://org"],
            ["pin:", "Search by pin/version", "pin:abc123"],
            ["path:", "Search by hierarchy path", "path:/ci/build"],
          ] as [string, string, string][]
        ).map(([prefix, desc, example]) => (
          <div
            key={prefix}
            style={{
              display: "grid",
              gridTemplateColumns: "4rem 1fr auto",
              gap: "0.5rem",
              padding: "0.3rem 0",
            }}
          >
            <span style={{ color: "#93c5fd", fontFamily: "monospace" }}>
              {prefix}
            </span>
            <span>{desc}</span>
            <span style={{ color: "#475569", fontFamily: "monospace" }}>
              {example}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          color: "#f1f5f9",
          fontWeight: 600,
          marginBottom: "0.5rem",
        }}
      >
        Navigation
      </div>
      <div
        style={{
          borderTop: "1px solid #334155",
          paddingTop: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "4rem 1fr auto",
            gap: "0.5rem",
            padding: "0.3rem 0",
          }}
        >
          <span style={{ color: "#a5b4fc", fontFamily: "monospace" }}>id:</span>
          <span>Go to workflow or step by UUID</span>
          <span style={{ color: "#475569", fontFamily: "monospace" }}>
            id:a1b2c3d4-...
          </span>
        </div>
        <p
          style={{ margin: "0.3rem 0", color: "#64748b", fontSize: "0.75rem" }}
        >
          The <span style={{ fontFamily: "monospace" }}>id:</span> prefix looks
          up a workflow or step directly by its UUID. It cannot be combined with
          other prefixes.
        </p>
      </div>
      <div
        style={{
          color: "#f1f5f9",
          fontWeight: 600,
          marginBottom: "0.5rem",
        }}
      >
        Escaping
      </div>
      <div
        style={{
          borderTop: "1px solid #334155",
          paddingTop: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        <p style={{ margin: "0.3rem 0" }}>
          Wrap in double quotes to search literally:
        </p>
        <p
          style={{
            margin: "0.3rem 0",
            fontFamily: "monospace",
            color: "#475569",
          }}
        >
          &quot;name:foo&quot; searches for the text name:foo
        </p>
      </div>
      <div
        style={{
          color: "#f1f5f9",
          fontWeight: 600,
          marginBottom: "0.5rem",
        }}
      >
        Combine multiple filters
      </div>
      <div
        style={{
          borderTop: "1px solid #334155",
          paddingTop: "0.5rem",
          marginBottom: "1rem",
          fontFamily: "monospace",
        }}
      >
        <p style={{ margin: "0.3rem 0", color: "#475569" }}>
          name:build pin:abc &nbsp;&nbsp; → name AND pin
        </p>
        <p style={{ margin: "0.3rem 0", color: "#475569" }}>
          name:&quot;my build&quot; uri:gcs → quoted value with spaces
        </p>
        <p style={{ margin: "0.3rem 0", color: "#475569" }}>
          build pin:abc &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; → &quot;build&quot; in
          any field AND pin
        </p>
      </div>
      <div
        style={{
          color: "#f1f5f9",
          fontWeight: 600,
          marginBottom: "0.5rem",
        }}
      >
        Tips
      </div>
      <div style={{ borderTop: "1px solid #334155", paddingTop: "0.5rem" }}>
        <p style={{ margin: "0.3rem 0" }}>
          • No prefix searches name, URI, and pin together
        </p>
        <p style={{ margin: "0.3rem 0" }}>
          • Multiple filters are ANDed together
        </p>
        <p style={{ margin: "0.3rem 0" }}>
          • Within a workflow, search is scoped to its steps
        </p>
        <p style={{ margin: "0.3rem 0" }}>
          • Press Esc to close, ↑↓ to navigate results
        </p>
      </div>
    </div>
  );
}
