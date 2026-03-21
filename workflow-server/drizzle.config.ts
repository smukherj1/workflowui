import { defineConfig } from "drizzle-kit";

const host = process.env.PGHOST ?? "localhost";
const port = process.env.PGPORT ?? "5432";
const database = process.env.PGDATABASE ?? "workflowui";
const user = process.env.PGUSER ?? "workflowui";
const password = process.env.PGPASSWORD ?? "workflowui";
const url = `postgresql://${user}:${password}@${host}:${port}/${database}`;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
