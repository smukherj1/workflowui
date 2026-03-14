import UploadForm from "../components/UploadForm";

export default function UploadPage() {
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
      <UploadForm />
    </div>
  );
}
