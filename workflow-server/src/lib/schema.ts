import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  uri: text("uri"),
  pin: text("pin"),
  startTime: timestamp("start_time", { withTimezone: true }),
  endTime: timestamp("end_time", { withTimezone: true }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + INTERVAL '7 days'`),
  totalSteps: integer("total_steps").notNull(),
  status: text("status").notNull(),
});

export const steps = pgTable("steps", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  stepId: text("step_id").notNull(),
  parentStepId: uuid("parent_step_id"),
  hierarchyPath: text("hierarchy_path").notNull(),
  name: text("name").notNull(),
  uri: text("uri"),
  pin: text("pin"),
  status: text("status").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }),
  endTime: timestamp("end_time", { withTimezone: true }),
  isLeaf: boolean("is_leaf").notNull(),
  depth: integer("depth").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const stepDependencies = pgTable(
  "step_dependencies",
  {
    stepUuid: uuid("step_uuid")
      .notNull()
      .references(() => steps.id, { onDelete: "cascade" }),
    dependsOnUuid: uuid("depends_on_uuid")
      .notNull()
      .references(() => steps.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.stepUuid, t.dependsOnUuid] })],
);

export const stepLogs = pgTable("step_logs", {
  stepUuid: uuid("step_uuid")
    .primaryKey()
    .references(() => steps.id, { onDelete: "cascade" }),
  logText: text("log_text").notNull(),
});
