import UploadForm from "../components/UploadForm";
import CommandPalette from "../components/CommandPalette";
import { useCommandPalette } from "../hooks/useCommandPalette";

export default function UploadPage() {
  const { paletteOpen, openPalette, closePalette } = useCommandPalette();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#0f172a",
        padding: "2rem",
        gap: "2rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ color: "#f1f5f9", fontSize: "2rem", margin: 0 }}>
          WorkflowUI
        </h1>
        <p style={{ color: "#64748b", margin: "0.5rem 0 0" }}>
          Visualize CI/CD workflow execution traces
        </p>
      </div>

      {/* Search trigger */}
      <button
        data-testid="search-trigger"
        onClick={openPalette}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 8,
          padding: "0.5rem 1rem",
          color: "#64748b",
          fontSize: "0.875rem",
          cursor: "pointer",
          width: "100%",
          maxWidth: 400,
        }}
      >
        🔍 Search or go to ID...
        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.7rem",
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 4,
            padding: "0.1rem 0.35rem",
            color: "#475569",
          }}
        >
          ⌘K
        </span>
      </button>

      <UploadForm />

      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
