import { Hono } from "hono";
import workflowsRouter from "./routes/workflows.js";
import stepsRouter, { stepsGlobalRouter } from "./routes/steps.js";
import logsRouter from "./routes/logs.js";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/workflows", workflowsRouter);
app.route("/api/workflows", stepsRouter);
app.route("/api/workflows", logsRouter);
app.route("/api/steps", stepsGlobalRouter);

const port = Number(process.env.PORT ?? 3001);
console.log(`workflow-server listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
