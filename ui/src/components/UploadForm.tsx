import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { uploadWorkflow, ApiError } from "../lib/api";

export default function UploadForm() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!file.name.endsWith(".json")) {
      setErrors(["Only .json files are accepted."]);
      return;
    }
    setErrors([]);
    setLoading(true);
    try {
      const result = await uploadWorkflow(file);
      const path = result.viewUrl.startsWith("http")
        ? new URL(result.viewUrl).pathname
        : result.viewUrl;
      navigate(path);
    } catch (err) {
      console.log(`Error uploading file ${file.name}:`, err);
      if (err instanceof ApiError) {
        setErrors(
          err.details?.length ? err.details : [err.message || "Upload failed"],
        );
      } else {
        setErrors(["A network error occurred. Please try again."]);
      }
    } finally {
      setLoading(false);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        alignItems: "center",
      }}
    >
      <div
        data-testid="upload"
        className="upload-dropzone"
        onClick={() => !loading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragOver ? "#60a5fa" : "#334155"}`,
          borderRadius: 12,
          padding: "3rem 4rem",
          cursor: loading ? "default" : "pointer",
          background: dragOver ? "#1e3a5f" : "#1e293b",
          textAlign: "center",
          transition: "all 0.15s",
          minWidth: 320,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".json"
          onChange={onInputChange}
          style={{ display: "none" }}
        />
        {loading ? (
          <div style={{ color: "#60a5fa" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>⏳</div>
            <div>Uploading...</div>
          </div>
        ) : (
          <div style={{ color: "#94a3b8" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📂</div>
            <div
              style={{
                fontWeight: 600,
                color: "#e2e8f0",
                marginBottom: "0.25rem",
              }}
            >
              Drop workflow JSON here
            </div>
            <div style={{ fontSize: "0.875rem" }}>
              or click to choose a file
            </div>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div
          style={{
            background: "#450a0a",
            border: "1px solid #ef4444",
            borderRadius: 8,
            padding: "1rem 1.5rem",
            color: "#fca5a5",
            maxWidth: 480,
            width: "100%",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            Upload error
          </div>
          <ul style={{ margin: 0, paddingLeft: "1.5rem" }}>
            {errors.map((e, i) => (
              <li key={i} style={{ fontSize: "0.875rem" }}>
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
