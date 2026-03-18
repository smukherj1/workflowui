import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { lookupStep, ApiError } from "../lib/api";

export default function NavigateForm() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = value.trim();
    if (!UUID_RE.test(id)) {
      setError("Please enter a valid UUID (workflow ID or step UUID).");
      return;
    }
    setError("");
    setLoading(true);
    try {
      // Try step lookup first
      const result = await lookupStep(id);
      navigate(`/workflows/${result.workflowId}/steps/${result.step.uuid}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Treat as workflow ID
        navigate(`/workflows/${id}`);
      } else {
        setError("Workflow or step not found.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%", maxWidth: 480 }}
    >
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="text"
          placeholder="Enter workflow ID or step UUID..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={loading}
          style={{
            flex: 1,
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 6,
            color: "#e2e8f0",
            padding: "0.5rem 0.75rem",
            fontSize: "0.875rem",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={loading || !value.trim()}
          style={{
            background: "#3b82f6",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: loading || !value.trim() ? "default" : "pointer",
            opacity: loading || !value.trim() ? 0.6 : 1,
          }}
        >
          Go
        </button>
      </div>
      {error && (
        <div style={{ color: "#fca5a5", fontSize: "0.875rem" }}>{error}</div>
      )}
    </form>
  );
}
