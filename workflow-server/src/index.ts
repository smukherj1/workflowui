import { Hono } from "hono";
import { logger } from "hono/logger";
import workflowsRouter from "./routes/workflows.js";
import stepsRouter, { stepsGlobalRouter } from "./routes/steps.js";
import logsRouter from "./routes/logs.js";
import searchRouter from "./routes/search.js";
import { pingDB } from "./lib/db.js";

const app = new Hono();
app.use(logger());

app.get("/health", async (c) => {
  const dbHealthy = await pingDB();
  if (dbHealthy) {
    return c.json({ status: "ok" });
  } else {
    return c.json(
      { status: "unhealthy", message: "Unable to reach the database" },
      503,
    );
  }
});

app.route("/api/workflows", workflowsRouter);
app.route("/api/workflows", stepsRouter);
app.route("/api/workflows", logsRouter);
app.route("/api/steps", stepsGlobalRouter);
app.route("/api/search", searchRouter);

const port = Number(process.env.PORT ?? 3001);

Bun.serve({
  port,
  fetch: app.fetch,
  // Number of seconds to wait before closing idle connections. Default is 10s.
  idleTimeout: 60,
});

console.log(`workflow-server listening on :${port}`);
