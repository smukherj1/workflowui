import * as fs from 'fs';
import * as path from 'path';

const API_BASE = process.env.API_URL ?? 'http://localhost:3001';
const DATA_DIR = path.join(__dirname, 'data');

interface TestCase {
  file: string;
  expectStatus: number;
  expectError?: string;
}

const testCases: TestCase[] = [
  { file: 'simple-linear.json', expectStatus: 201 },
  { file: 'parallel-diamond.json', expectStatus: 201 },
  { file: 'nested-hierarchy.json', expectStatus: 201 },
  { file: 'mixed-status.json', expectStatus: 201 },
  { file: 'invalid-cycle.json', expectStatus: 400, expectError: 'STRUCTURAL_INVALID' },
];

async function runTest(tc: TestCase): Promise<boolean> {
  const filePath = path.join(DATA_DIR, tc.file);
  const body = fs.readFileSync(filePath, 'utf8');

  try {
    const res = await fetch(`${API_BASE}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const json = await res.json() as Record<string, unknown>;

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
      console.log(`  PASS [${tc.file}]: workflowId=${json.workflowId}`);
    } else {
      if (tc.expectError && json.error !== tc.expectError) {
        console.error(`  FAIL [${tc.file}]: expected error=${tc.expectError}, got ${json.error}`);
        return false;
      }
      console.log(`  PASS [${tc.file}]: error=${json.error} details=${JSON.stringify(json.details)}`);
    }

    return true;
  } catch (err) {
    console.error(`  FAIL [${tc.file}]: request threw`, err);
    return false;
  }
}

async function main() {
  console.log(`Running E2E upload tests against ${API_BASE}\n`);

  // Check health
  try {
    const health = await fetch(`${API_BASE}/health`);
    const data = await health.json() as { status: string };
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
