#!/usr/bin/env bun
import * as fs from "fs";
import * as path from "path";

const API_BASE = process.env.API_URL ?? "http://localhost:3001";
const DATA_DIR = path.join(import.meta.dir, "../tests/data");

// Only upload valid workflow fixtures (skip invalid-* files)
const SKIP = new Set(["invalid-json.json", "invalid-schema.json", "invalid-cycle.json"]);

const files = fs
  .readdirSync(DATA_DIR)
  .filter((f) => f.endsWith(".json") && !SKIP.has(f));

for (const file of files) {
  const body = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
  const res = await fetch(`${API_BASE}/api/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (res.status === 201) {
    console.log(`✓ ${file} → workflowId=${json.workflowId}  ${json.viewUrl}`);
  } else {
    console.error(`✗ ${file} → HTTP ${res.status}:`, JSON.stringify(json));
  }
}
