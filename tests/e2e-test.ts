import * as fs from 'fs';
import * as path from 'path';

const API_BASE = process.env.API_URL ?? 'http://localhost:3001';
const DATA_DIR = path.join(__dirname, 'data');

interface LogExpectation {
  minLines: number;
  containsText?: string;
  stepId?: string;
}

interface TestCase {
  file: string;
  expectStatus: number;
  expectError?: string;
  // stepPath (hierarchyPath) → expected log content, checked during log proxy tests
  logExpectations?: Record<string, LogExpectation>;
}

const testCases: TestCase[] = [
  {
    file: 'simple-linear.json',
    expectStatus: 201,
    logExpectations: {
      '/checkout': { minLines: 2, containsText: 'Cloning into repo...', stepId: 'checkout' },
    },
  },
  {
    file: 'parallel-diamond.json',
    expectStatus: 201,
    logExpectations: {
      '/setup': { minLines: 1, containsText: 'Environment setup complete.', stepId: 'setup' },
    },
  },
  {
    file: 'nested-hierarchy.json',
    expectStatus: 201,
    logExpectations: {
      // Leaf child of "ci": its own 2 log lines
      '/ci/build-frontend': { minLines: 2, containsText: 'Building React app...', stepId: 'build-frontend' },
      // Merged logs for "ci" parent: all 4 descendant leaf steps × 2 lines each
      '/ci': { minLines: 8 },
    },
  },
  {
    file: 'mixed-status.json',
    expectStatus: 201,
    logExpectations: {
      '/setup': { minLines: 1, containsText: 'Setup complete.', stepId: 'setup' },
    },
  },
  { file: 'invalid-cycle.json', expectStatus: 400, expectError: 'STRUCTURAL_INVALID' },
];

async function apiGet(path: string): Promise<{ status: number; json: unknown }> {
  const url = `${API_BASE}${path}`;
  console.log(`    → GET ${path}`);
  const res = await fetch(url);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(
      `GET ${path} returned non-JSON (${res.status} ${res.statusText}): ${text.slice(0, 200)}`,
    );
  }
  const json = await res.json();
  return { status: res.status, json };
}

async function testWorkflowDetail(workflowId: string, file: string): Promise<boolean> {
  console.log(`  [${file}] checking workflow detail`);
  const { status, json } = await apiGet(`/api/workflows/${workflowId}`);
  const body = json as Record<string, unknown>;

  if (status !== 200) {
    console.error(`  FAIL [${file}] GET /workflows/:id: expected 200, got ${status}`, body);
    return false;
  }
  if (!body.id || !body.name || !body.status || body.totalSteps == null) {
    console.error(`  FAIL [${file}] GET /workflows/:id: missing fields`, body);
    return false;
  }
  console.log(`    ✓ workflow detail: name="${body.name}" status=${body.status} totalSteps=${body.totalSteps}`);
  return true;
}

async function testTopLevelSteps(workflowId: string, file: string): Promise<string | null> {
  console.log(`  [${file}] checking top-level steps`);
  const { status, json } = await apiGet(`/api/workflows/${workflowId}/steps`);
  const body = json as Record<string, unknown>;

  if (status !== 200) {
    console.error(`  FAIL [${file}] GET /steps: expected 200, got ${status}`, body);
    return null;
  }

  const steps = body.steps as Array<Record<string, unknown>>;
  if (!Array.isArray(steps) || steps.length === 0) {
    console.error(`  FAIL [${file}] GET /steps: expected non-empty steps array`, body);
    return null;
  }
  if (!Array.isArray(body.dependencies)) {
    console.error(`  FAIL [${file}] GET /steps: missing dependencies array`, body);
    return null;
  }

  console.log(
    `    ✓ top-level steps: ${steps.length} steps, ${(body.dependencies as unknown[]).length} deps`,
  );

  // Return UUID of first non-leaf step if available, else first step
  const nonLeaf = steps.find((s) => !s.isLeaf);
  return ((nonLeaf ?? steps[0]).uuid as string) ?? null;
}

async function testChildSteps(workflowId: string, parentUuid: string, file: string): Promise<string | null> {
  console.log(`  [${file}] checking child steps for parent ${parentUuid.slice(0, 8)}…`);
  const { status, json } = await apiGet(
    `/api/workflows/${workflowId}/steps?parentId=${parentUuid}`,
  );
  const body = json as Record<string, unknown>;

  if (status !== 200) {
    console.error(`  FAIL [${file}] GET /steps?parentId=: expected 200, got ${status}`, body);
    return null;
  }

  const steps = body.steps as Array<Record<string, unknown>>;
  if (!Array.isArray(steps)) {
    console.error(`  FAIL [${file}] GET /steps?parentId=: expected steps array`, body);
    return null;
  }

  console.log(`    ✓ child steps for ${parentUuid.slice(0, 8)}…: ${steps.length} steps`);
  return steps.length > 0 ? (steps[0].uuid as string) : null;
}

async function testStepDetail(
  workflowId: string,
  stepUuid: string,
  expectBreadcrumbs: number,
  file: string,
): Promise<boolean> {
  console.log(`  [${file}] checking step detail for ${stepUuid.slice(0, 8)}… (expect ${expectBreadcrumbs} breadcrumbs)`);
  const { status, json } = await apiGet(`/api/workflows/${workflowId}/steps/${stepUuid}`);
  const body = json as Record<string, unknown>;

  if (status !== 200) {
    console.error(`  FAIL [${file}] GET /steps/:uuid: expected 200, got ${status}`, body);
    return false;
  }

  const step = body.step as Record<string, unknown>;
  const breadcrumbs = body.breadcrumbs as unknown[];

  if (!step || !step.uuid || !step.name || !step.status) {
    console.error(`  FAIL [${file}] GET /steps/:uuid: missing step fields`, body);
    return false;
  }
  if (!Array.isArray(breadcrumbs)) {
    console.error(`  FAIL [${file}] GET /steps/:uuid: breadcrumbs not array`, body);
    return false;
  }
  if (breadcrumbs.length !== expectBreadcrumbs) {
    console.error(
      `  FAIL [${file}] GET /steps/:uuid: expected ${expectBreadcrumbs} breadcrumbs, got ${breadcrumbs.length}`,
    );
    return false;
  }

  console.log(
    `    ✓ step detail: name="${step.name}" breadcrumbs=${breadcrumbs.length}`,
  );
  return true;
}

interface LogLine {
  timestampNs: string;
  line: string;
  stepPath: string;
  stepId: string;
  depth: string;
}

async function testLogProxy(
  workflowId: string,
  stepPath: string,
  file: string,
  expect?: { minLines: number; containsText?: string; stepId?: string },
): Promise<boolean> {
  console.log(`  [${file}] checking log proxy for path "${stepPath}"`);
  const { status, json } = await apiGet(
    `/api/workflows/${workflowId}/logs?stepPath=${encodeURIComponent(stepPath)}`,
  );
  const body = json as Record<string, unknown>;

  if (status !== 200) {
    console.error(`  FAIL [${file}] GET /logs: expected 200, got ${status}`, body);
    return false;
  }
  if (!Array.isArray(body.lines)) {
    console.error(`  FAIL [${file}] GET /logs: missing lines array`, body);
    return false;
  }

  const lines = body.lines as LogLine[];

  if (expect) {
    if (lines.length < expect.minLines) {
      console.error(
        `  FAIL [${file}] GET /logs "${stepPath}": expected >= ${expect.minLines} lines, got ${lines.length}`,
        lines,
      );
      return false;
    }

    if (expect.containsText) {
      const found = lines.some((l) => l.line.includes(expect.containsText!));
      if (!found) {
        console.error(
          `  FAIL [${file}] GET /logs "${stepPath}": no line contains "${expect.containsText}"`,
          lines.map((l) => l.line),
        );
        return false;
      }
    }

    if (expect.stepId) {
      const badLabels = lines.filter((l) => l.stepPath === '' || l.stepId === '');
      if (badLabels.length > 0) {
        console.error(
          `  FAIL [${file}] GET /logs "${stepPath}": ${badLabels.length} lines have empty stepPath/stepId`,
          badLabels,
        );
        return false;
      }
      const wrongStep = lines.filter((l) => l.stepId !== expect.stepId);
      if (wrongStep.length > 0) {
        console.error(
          `  FAIL [${file}] GET /logs "${stepPath}": lines have unexpected stepId (want "${expect.stepId}")`,
          wrongStep.map((l) => ({ stepId: l.stepId, line: l.line })),
        );
        return false;
      }
    }
  }

  console.log(
    `    ✓ log proxy for path "${stepPath}": ${lines.length} lines` +
      (lines.length > 0 ? `, stepPath="${lines[0].stepPath}", stepId="${lines[0].stepId}"` : ''),
  );
  return true;
}

async function testGrafanaRedirect(workflowId: string, stepUuid: string, file: string): Promise<boolean> {
  const explorePath = `/api/workflows/${workflowId}/steps/${stepUuid}/logs/explore`;
  console.log(`  [${file}] checking Grafana redirect`);
  console.log(`    → GET ${explorePath}`);
  const res = await fetch(`${API_BASE}${explorePath}`, {
    redirect: 'manual',
  });

  if (res.status !== 302) {
    console.error(`  FAIL [${file}] GET /logs/explore: expected 302, got ${res.status}`);
    return false;
  }
  const location = res.headers.get('location');
  if (!location || !location.includes('/explore')) {
    console.error(`  FAIL [${file}] GET /logs/explore: missing or invalid Location header`, location);
    return false;
  }

  console.log(`    ✓ Grafana redirect → ${location.slice(0, 80)}…`);
  return true;
}

async function runTest(tc: TestCase): Promise<boolean> {
  const filePath = path.join(DATA_DIR, tc.file);
  const body = fs.readFileSync(filePath, 'utf8');

  try {
    const res = await fetch(`${API_BASE}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const json = (await res.json()) as Record<string, unknown>;

    if (res.status !== tc.expectStatus) {
      console.error(`  FAIL [${tc.file}]: expected status ${tc.expectStatus}, got ${res.status}`);
      console.error(`    body:`, JSON.stringify(json));
      return false;
    }

    if (tc.expectStatus === 201) {
      if (!json.workflowId || !json.viewUrl) {
        console.error(`  FAIL [${tc.file}]: missing workflowId or viewUrl in response`);
        console.error(`    body:`, JSON.stringify(json));
        return false;
      }

      const workflowId = json.workflowId as string;
      console.log(`  PASS [${tc.file}]: upload ok, workflowId=${workflowId}`);

      // ── Phase 3 API checks ────────────────────────────────────────────────
      let allOk = true;

      allOk = (await testWorkflowDetail(workflowId, tc.file)) && allOk;

      const firstStepUuid = await testTopLevelSteps(workflowId, tc.file);
      if (!firstStepUuid) return false;

      // Step detail for a top-level step (0 breadcrumbs expected)
      allOk = (await testStepDetail(workflowId, firstStepUuid, 0, tc.file)) && allOk;

      // Grafana redirect for the top-level step
      allOk = (await testGrafanaRedirect(workflowId, firstStepUuid, tc.file)) && allOk;

      // Child steps for the first non-leaf top-level step, if any
      const { json: stepsJson } = await apiGet(`/api/workflows/${workflowId}/steps`);
      const topSteps = (stepsJson as Record<string, unknown>).steps as Array<Record<string, unknown>>;
      const nonLeafTop = topSteps.find((s) => !s.isLeaf);

      if (nonLeafTop) {
        const parentUuid = nonLeafTop.uuid as string;
        const childUuid = await testChildSteps(workflowId, parentUuid, tc.file);

        if (childUuid) {
          // Child step detail should have 1 breadcrumb (the parent)
          allOk = (await testStepDetail(workflowId, childUuid, 1, tc.file)) && allOk;

          // Log proxy for the child step path
          const childDetail = await apiGet(`/api/workflows/${workflowId}/steps/${childUuid}`);
          const childStep = (childDetail.json as Record<string, unknown>).step as Record<string, unknown>;
          if (childStep?.hierarchyPath) {
            const childPath = childStep.hierarchyPath as string;
            allOk = (await testLogProxy(workflowId, childPath, tc.file, tc.logExpectations?.[childPath])) && allOk;
          }
        }
      }

      // Log proxy for the first top-level step (may be a parent — merged view)
      const { json: detailJson } = await apiGet(`/api/workflows/${workflowId}/steps/${firstStepUuid}`);
      const topStep = (detailJson as Record<string, unknown>).step as Record<string, unknown>;
      if (topStep?.hierarchyPath) {
        const topPath = topStep.hierarchyPath as string;
        allOk = (await testLogProxy(workflowId, topPath, tc.file, tc.logExpectations?.[topPath])) && allOk;
      }

      return allOk;
    } else {
      if (tc.expectError && json.error !== tc.expectError) {
        console.error(`  FAIL [${tc.file}]: expected error=${tc.expectError}, got ${json.error}`);
        return false;
      }
      console.log(`  PASS [${tc.file}]: error=${json.error} details=${JSON.stringify(json.details)}`);
      return true;
    }
  } catch (err) {
    console.error(`  FAIL [${tc.file}]: request threw`, err);
    return false;
  }
}

async function main() {
  console.log(`Running E2E tests against ${API_BASE}\n`);

  // Health check
  try {
    const health = await fetch(`${API_BASE}/health`);
    const data = (await health.json()) as { status: string };
    console.log(`Health check: ${data.status}\n`);
  } catch {
    console.error(`Cannot reach API at ${API_BASE}. Is the server running?`);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const ok = await runTest(tc);
    if (ok) passed++;
    else failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
