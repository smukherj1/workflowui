import { Routes, Route } from "react-router-dom";
import UploadPage from "./pages/UploadPage";
import WorkflowView from "./pages/WorkflowView";
import StepView from "./pages/StepView";
import LogsPage from "./pages/LogsPage";
import SearchPage from "./pages/SearchPage";
import WorkflowLayout from "./components/WorkflowLayout";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<UploadPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/workflows/:workflowId/logs" element={<LogsPage />} />
      <Route path="/workflows/:workflowId" element={<WorkflowLayout />}>
        <Route index element={<WorkflowView />} />
        <Route path="steps/:uuid" element={<StepView />} />
      </Route>
    </Routes>
  );
}
