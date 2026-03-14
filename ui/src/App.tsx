import { Routes, Route } from "react-router-dom";

function UploadPage() {
  return (
    <div style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>WorkflowUI</h1>
      <p>Hello World</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<UploadPage />} />
    </Routes>
  );
}
