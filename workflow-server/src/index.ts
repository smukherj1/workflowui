import { Hono } from "hono";
import { serve } from "bun";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

serve({
  fetch: app.fetch,
  port: 3001,
});
