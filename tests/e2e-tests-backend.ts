import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";

const API_BASE = process.env.API_URL ?? "http://localhost:3001";
const DATA_DIR = path.join(__dirname, "data");

// ── Helpers ────────────────────────────────────────────────────────────────

function readFixture(file: string): string {
  return fs.readFileSync(path.join(DATA_DIR, file), "utf8");
}

async function post(
  endpoint: string,
  body: string,
  contentType = "application/json",
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function get(
  endpoint: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${API_BASE}${endpoint}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `GET ${endpoint} returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const json = await res.json();
  return { status: res.status, json };
}

async function deleteWorkflow(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/workflows/${id}`, { method: "DELETE" });
}

async function uploadWorkflow(file: string): Promise<string> {
  const { status, json } = await post("/api/workflows", readFixture(file));
  const body = json as Record<string, unknown>;
  expect(status, `upload ${file}: expected 201`).toBe(201);
  expect(body.workflowId, "upload response missing workflowId").toBeString();
  expect(body.viewUrl, "upload response missing viewUrl").toBeString();
  return body.workflowId as string;
}

// ── Health ─────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const { status, json } = await get("/health");
    expect(status).toBe(200);
    expect((json as Record<string, unknown>).status).toBe("ok");
  });
});

// ── Invalid uploads ────────────────────────────────────────────────────────

describe("POST /api/workflows — invalid payloads", () => {
  test("invalid-json.json: returns 400", async () => {
    const { status } = await post(
      "/api/workflows",
      readFixture("invalid-json.json"),
    );
    expect(status).toBe(400);
  });

  test("invalid-schema.json: returns 400", async () => {
    const { status, json } = await post(
      "/api/workflows",
      readFixture("invalid-schema.json"),
    );
    expect(status).toBe(400);
    // Missing required workflow.metadata.name → schema validation error
    const body = json as Record<string, unknown>;
    expect(body.error).toBeString();
  });

  test("invalid-cycle.json: returns 400 STRUCTURAL_INVALID", async () => {
    const { status, json } = await post(
      "/api/workflows",
      readFixture("invalid-cycle.json"),
    );
    const body = json as Record<string, unknown>;
    expect(status).toBe(400);
    expect(body.error).toBe("STRUCTURAL_INVALID");
  });
});

// ── simple-linear.json ─────────────────────────────────────────────────────

describe("simple-linear.json", () => {
  let workflowId: string;

  beforeAll(async () => {
    workflowId = await uploadWorkflow("simple-linear.json");
  });

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test("GET /api/workflows/:id returns workflow detail", async () => {
    const { status, json } = await get(`/api/workflows/${workflowId}`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    expect(body.id).toBeString();
    expect(body.name).toBe("simple-linear-pipeline");
    expect(body.uri).toBe("github://org/repo");
    expect(body.pin).toBe("abc123");
    expect(body.status).toBeString();
    expect(body.totalSteps).toBeNumber();
    expect(body.uploadedAt).toBeString();
    expect(body.expiresAt).toBeString();
  });

  test("GET /api/workflows/:id/steps returns top-level steps with dependencies", async () => {
    const { status, json } = await get(`/api/workflows/${workflowId}/steps`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    expect(body.steps).toBeArray();
    expect((body.steps as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(body.dependencies).toBeArray();

    const steps = body.steps as Record<string, unknown>[];
    const first = steps[0];
    expect(first.uuid).toBeString();
    expect(first.stepId).toBeString();
    expect(first.name).toBeString();
    expect(first.status).toBeString();
    expect(first.isLeaf).toBeBoolean();
    expect(first.childCount).toBeNumber();
  });

  test("GET /api/workflows/:id/steps/:uuid returns step detail with breadcrumbs", async () => {
    const { json: stepsJson } = await get(`/api/workflows/${workflowId}/steps`);
    const steps = (stepsJson as Record<string, unknown>).steps as Record<
      string,
      unknown
    >[];
    const stepUuid = steps[0].uuid as string;

    const { status, json } = await get(
      `/api/workflows/${workflowId}/steps/${stepUuid}`,
    );
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);

    const step = body.step as Record<string, unknown>;
    expect(step.uuid).toBeString();
    expect(step.name).toBeString();
    expect(step.status).toBeString();
    expect(step.hierarchyPath).toBeString();
    expect(step.isLeaf).toBeBoolean();
    expect(step.depth).toBeNumber();

    const breadcrumbs = body.breadcrumbs as unknown[];
    expect(breadcrumbs).toBeArray();
    // Top-level step: 1 breadcrumb (itself)
    expect(breadcrumbs.length).toBe(1);
  });

  test("GET /api/workflows/:id/logs?stepPath=/checkout returns leaf logs", async () => {
    const { status, json } = await get(
      `/api/workflows/${workflowId}/logs?stepPath=${encodeURIComponent("/checkout")}`,
    );
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    expect(body.lines).toBeArray();

    const lines = body.lines as Record<string, unknown>[];
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const hasCloneLog = lines.some((l) =>
      (l.line as string).includes("Cloning into repo..."),
    );
    expect(hasCloneLog).toBe(true);

    // All lines should have stepId = "checkout"
    const badStepIds = lines.filter((l) => l.stepId !== "checkout");
    expect(badStepIds.length).toBe(0);

    // All lines should have non-empty stepPath and stepId
    const emptyLabels = lines.filter((l) => !l.stepPath || !l.stepId);
    expect(emptyLabels.length).toBe(0);
  });
});

// ── parallel-diamond.json ──────────────────────────────────────────────────

describe("parallel-diamond.json", () => {
  let workflowId: string;

  beforeAll(async () => {
    workflowId = await uploadWorkflow("parallel-diamond.json");
  });

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test("GET /api/workflows/:id returns workflow detail", async () => {
    const { status, json } = await get(`/api/workflows/${workflowId}`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    expect(body.name).toBe("parallel-diamond-pipeline");
    expect(body.totalSteps).toBeNumber();
  });

  test("GET /api/workflows/:id/steps returns steps and dependencies", async () => {
    const { status, json } = await get(`/api/workflows/${workflowId}/steps`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    const steps = body.steps as unknown[];
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect((body.dependencies as unknown[]).length).toBeGreaterThan(0);
  });

  test("GET /api/workflows/:id/logs?stepPath=/setup returns logs", async () => {
    const { status, json } = await get(
      `/api/workflows/${workflowId}/logs?stepPath=${encodeURIComponent("/setup")}`,
    );
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);

    const lines = body.lines as Record<string, unknown>[];
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const hasSetupLog = lines.some((l) =>
      (l.line as string).includes("Environment setup complete."),
    );
    expect(hasSetupLog).toBe(true);
  });
});

// ── nested-hierarchy.json ──────────────────────────────────────────────────

describe("nested-hierarchy.json", () => {
  let workflowId: string;

  beforeAll(async () => {
    workflowId = await uploadWorkflow("nested-hierarchy.json");
  });

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test("GET /api/workflows/:id returns workflow detail", async () => {
    const { status, json } = await get(`/api/workflows/${workflowId}`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    expect(body.name).toBe("nested-hierarchy-pipeline");
  });

  test("GET /api/workflows/:id/steps returns top-level steps", async () => {
    const { status, json } = await get(`/api/workflows/${workflowId}/steps`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    const steps = body.steps as Record<string, unknown>[];
    expect(steps.length).toBeGreaterThanOrEqual(1);
  });

  test("child steps of non-leaf parent are returned", async () => {
    const { json: stepsJson } = await get(`/api/workflows/${workflowId}/steps`);
    const steps = (stepsJson as Record<string, unknown>).steps as Record<
      string,
      unknown
    >[];
    const nonLeaf = steps.find((s) => !s.isLeaf);
    expect(nonLeaf).toBeDefined();

    const parentUuid = nonLeaf!.uuid as string;
    const { status, json } = await get(
      `/api/workflows/${workflowId}/steps?parentId=${parentUuid}`,
    );
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    expect(body.steps).toBeArray();
    expect((body.steps as unknown[]).length).toBeGreaterThan(0);
  });

  test("child step detail has 2 breadcrumbs", async () => {
    const { json: topJson } = await get(`/api/workflows/${workflowId}/steps`);
    const topSteps = (topJson as Record<string, unknown>).steps as Record<
      string,
      unknown
    >[];
    const nonLeaf = topSteps.find((s) => !s.isLeaf);
    expect(nonLeaf).toBeDefined();

    const { json: childJson } = await get(
      `/api/workflows/${workflowId}/steps?parentId=${nonLeaf!.uuid}`,
    );
    const childSteps = (childJson as Record<string, unknown>).steps as Record<
      string,
      unknown
    >[];
    expect(childSteps.length).toBeGreaterThan(0);

    const childUuid = childSteps[0].uuid as string;
    const { status, json } = await get(
      `/api/workflows/${workflowId}/steps/${childUuid}`,
    );
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    // Child of top-level: 2 breadcrumbs (parent + child)
    expect((body.breadcrumbs as unknown[]).length).toBe(2);
  });

  test("GET /api/workflows/:id/logs?stepPath=/ci/build-frontend returns leaf logs", async () => {
    const { status, json } = await get(
      `/api/workflows/${workflowId}/logs?stepPath=${encodeURIComponent("/ci/build-frontend")}`,
    );
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);

    const lines = body.lines as Record<string, unknown>[];
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const hasBuildLog = lines.some((l) =>
      (l.line as string).includes("Building React app..."),
    );
    expect(hasBuildLog).toBe(true);

    const badStepIds = lines.filter((l) => l.stepId !== "build-frontend");
    expect(badStepIds.length).toBe(0);
  });

  test("GET /api/workflows/:id/logs?stepPath=/ci returns merged logs for all leaf descendants", async () => {
    const { status, json } = await get(
      `/api/workflows/${workflowId}/logs?stepPath=${encodeURIComponent("/ci")}`,
    );
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);

    const lines = body.lines as Record<string, unknown>[];
    // ci has 4 leaf descendants (build-frontend, build-backend, api-tests, e2e-tests)
    // each with 2 log lines → at least 8 lines total
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });
});

// ── mixed-status.json ──────────────────────────────────────────────────────

describe("mixed-status.json", () => {
  let workflowId: string;

  beforeAll(async () => {
    workflowId = await uploadWorkflow("mixed-status.json");
  });

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test("GET /api/workflows/:id returns workflow detail", async () => {
    const { status, json } = await get(`/api/workflows/${workflowId}`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    expect(body.name).toBe("mixed-status-pipeline");
  });

  test("GET /api/workflows/:id/steps includes steps with multiple statuses", async () => {
    const { status, json } = await get(`/api/workflows/${workflowId}/steps`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);

    const steps = body.steps as Record<string, unknown>[];
    const statuses = new Set(steps.map((s) => s.status));
    // Expect at least passed and one other status
    expect(statuses.size).toBeGreaterThanOrEqual(2);
  });

  test("GET /api/workflows/:id/logs?stepPath=/setup returns logs", async () => {
    const { status, json } = await get(
      `/api/workflows/${workflowId}/logs?stepPath=${encodeURIComponent("/setup")}`,
    );
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);

    const lines = body.lines as Record<string, unknown>[];
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const hasSetupLog = lines.some((l) =>
      (l.line as string).includes("Setup complete."),
    );
    expect(hasSetupLog).toBe(true);
  });
});

// ── GET /api/steps/:uuid (cross-workflow step lookup) ─────────────────────

describe("GET /api/steps/:uuid", () => {
  let workflowId: string;
  let stepUuid: string;

  beforeAll(async () => {
    workflowId = await uploadWorkflow("simple-linear.json");
    const { json } = await get(`/api/workflows/${workflowId}/steps`);
    const steps = (json as Record<string, unknown>).steps as Record<
      string,
      unknown
    >[];
    stepUuid = steps[0].uuid as string;
  });

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test("returns workflowId and step detail", async () => {
    const { status, json } = await get(`/api/steps/${stepUuid}`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    expect(body.workflowId).toBe(workflowId);

    const step = body.step as Record<string, unknown>;
    expect(step.uuid).toBe(stepUuid);
    expect(step.name).toBeString();
    expect(step.status).toBeString();
    expect(step.hierarchyPath).toBeString();

    expect(body.breadcrumbs).toBeArray();
  });

  test("returns 404 for unknown UUID", async () => {
    const { status } = await get(
      "/api/steps/00000000-0000-0000-0000-000000000000",
    );
    expect(status).toBe(404);
  });
});

// ── large-linear.json (performance regression baseline) ────────────────────

describe("large-linear.json", () => {
  let workflowId: string;

  beforeAll(async () => {
    workflowId = await uploadWorkflow("large-linear.json");
  }, 10_000);

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  }, 10_000);

  test("GET /api/workflows/:id returns workflow detail", async () => {
    const { status, json } = await get(`/api/workflows/${workflowId}`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);
    expect(body.id).toBeString();
    expect(body.name).toBe("large-linear-pipeline");
    expect(body.uri).toBe("github://org/repo");
    expect(body.pin).toBe("abc123");
    expect(body.status).toBeString();
    expect(body.totalSteps).toBeNumber();
    expect(body.uploadedAt).toBeString();
    expect(body.expiresAt).toBeString();
  });

  test("GET /api/workflows/:id/steps returns top-level steps (checkout, build, test)", async () => {
    const { status, json } = await get(`/api/workflows/${workflowId}/steps`);
    const body = json as Record<string, unknown>;
    expect(status).toBe(200);

    const steps = body.steps as Record<string, unknown>[];
    const stepIds = steps.map((s) => s.stepId as string);
    expect(stepIds).toContain("checkout");
    expect(stepIds).toContain("build");
    expect(stepIds).toContain("test");

    // All three are non-leaf parents with many children
    for (const step of steps) {
      expect(step.isLeaf).toBe(false);
      expect(step.childCount as number).toBeGreaterThan(0);
    }
  });

  // Helper: fetch all child steps of a top-level step by its stepId label.
  async function getAllChildSteps(
    parentStepId: string,
  ): Promise<Record<string, unknown>[]> {
    const { json: topJson } = await get(`/api/workflows/${workflowId}/steps`);
    const topSteps = (topJson as Record<string, unknown>).steps as Record<
      string,
      unknown
    >[];
    const parent = topSteps.find((s) => s.stepId === parentStepId);
    expect(parent, `top-level step "${parentStepId}" not found`).toBeDefined();

    const { json } = await get(
      `/api/workflows/${workflowId}/steps?parentId=${parent!.uuid}`,
    );
    const body = json as Record<string, unknown>;
    return body.steps as Record<string, unknown>[];
  }

  // ── checkout (4000 substeps) ──────────────────────────────────────────────

  test("checkout: first substep (checkout-0) is present with correct detail", async () => {
    const children = await getAllChildSteps("checkout");
    const first = children.find((s) => s.stepId === "checkout-0");
    expect(first, "checkout-0 not found").toBeDefined();
    expect(first!.name).toBe("Checkout Step 0");
    expect(first!.isLeaf).toBe(true);
    expect(first!.status).toBe("passed");
  });

  test("checkout: last substep (checkout-3999) is present with correct detail", async () => {
    const children = await getAllChildSteps("checkout");
    const last = children.find((s) => s.stepId === "checkout-3999");
    expect(last, "checkout-3999 not found").toBeDefined();
    expect(last!.name).toBe("Checkout Step 3999");
    expect(last!.isLeaf).toBe(true);
    expect(last!.status).toBe("passed");
  });

  // ── build (2000 substeps) ─────────────────────────────────────────────────

  test("build: first substep (build-0) is present with correct detail", async () => {
    const children = await getAllChildSteps("build");
    const first = children.find((s) => s.stepId === "build-0");
    expect(first, "build-0 not found").toBeDefined();
    expect(first!.name).toBe("Build Step 0");
    expect(first!.isLeaf).toBe(true);
    expect(first!.status).toBe("passed");
  });

  test("build: last substep (build-1999) is present with correct detail", async () => {
    const children = await getAllChildSteps("build");
    const last = children.find((s) => s.stepId === "build-1999");
    expect(last, "build-1999 not found").toBeDefined();
    expect(last!.name).toBe("Build Step 1999");
    expect(last!.isLeaf).toBe(true);
    expect(last!.status).toBe("passed");
  });

  // ── test (5000 substeps) ──────────────────────────────────────────────────

  test("test: first substep (test-0) is present with correct detail", async () => {
    const children = await getAllChildSteps("test");
    const first = children.find((s) => s.stepId === "test-0");
    expect(first, "test-0 not found").toBeDefined();
    expect(first!.name).toBe("Test Step 0");
    expect(first!.isLeaf).toBe(true);
    expect(first!.status).toBe("passed");
  });

  test("test: last substep (test-4999) is present with correct detail", async () => {
    const children = await getAllChildSteps("test");
    const last = children.find((s) => s.stepId === "test-4999");
    expect(last, "test-4999 not found").toBeDefined();
    expect(last!.name).toBe("Test Step 4999");
    expect(last!.isLeaf).toBe(true);
    expect(last!.status).toBe("passed");
  });
});
