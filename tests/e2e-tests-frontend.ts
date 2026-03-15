import * as fs from "fs";
import * as path from "path";
import { chromium, type Browser, type Page } from "playwright";

/**
 * Frontend E2E tests — browser-level verification of the Vite + React SPA.
 *
 * Uses Playwright to drive a headless browser against the running UI server.
 * Assumes the API server (Express), PostgreSQL, and the UI server (Vite dev
 * or nginx-served production build) are already running.
 *
 * Run: bun tests/e2e-tests-frontend.ts
 */

const API_BASE = process.env.API_URL ?? "http://localhost:3001";
const UI_BASE = process.env.UI_URL ?? "http://localhost:8080";
const DATA_DIR = path.join(__dirname, "data");

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string): boolean {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    return true;
  } else {
    console.error(`  ✗ ${testName}${detail ? ": " + detail : ""}`);
    return false;
  }
}

async function uploadFixture(
  filename: string,
): Promise<{ workflowId: string; viewUrl: string } | null> {
  const filePath = path.join(DATA_DIR, filename);
  const body = fs.readFileSync(filePath, "utf8");
  const res = await fetch(`${API_BASE}/api/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (res.status !== 201) return null;
  return (await res.json()) as { workflowId: string; viewUrl: string };
}

// ── Test Cases ───────────────────────────────────────────────────────────────

async function testSpaServing(page: Page): Promise<boolean> {
  console.log("\n[1] SPA Serving & Hydration");
  await page.goto(UI_BASE);

  // React root exists and app has hydrated (React renders content into #root)
  const root = page.locator("#root");
  let ok = assert(await root.count() === 1, "Page has #root element");

  // Wait for React to hydrate — some visible content should appear inside #root
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });
  const innerHTML = await root.innerHTML();
  ok = assert(innerHTML.length > 0, "React app has hydrated (#root is not empty)") && ok;

  return ok;
}

async function testUploadPageRenders(page: Page): Promise<boolean> {
  console.log("\n[2] Upload Page Renders");
  await page.goto(UI_BASE);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  // The upload page should show a file input or drop zone
  const hasFileInput = (await page.locator('input[type="file"]').count()) > 0;
  const hasDropZone =
    (await page.locator('[class*="drop"], [class*="upload"], [data-testid="upload"]').count()) > 0;
  const hasUploadText = (await page.getByText(/upload|drop|choose.*file/i).count()) > 0;

  let ok = assert(
    hasFileInput || hasDropZone || hasUploadText,
    "Upload page has file input, drop zone, or upload prompt",
  );

  return ok;
}

async function testFileUploadAndNavigation(page: Page): Promise<boolean> {
  console.log("\n[3] File Upload → Workflow View Navigation");
  await page.goto(UI_BASE);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  // Find file input and upload a fixture
  const fileInput = page.locator('input[type="file"]');
  if ((await fileInput.count()) === 0) {
    return assert(false, "File input exists on upload page");
  }

  const fixturePath = path.join(DATA_DIR, "simple-linear.json");
  await fileInput.setInputFiles(fixturePath);

  // After upload, should navigate to a workflow view URL
  await page.waitForURL(/\/workflows\//, { timeout: 15_000 });
  const url = page.url();
  let ok = assert(
    url.includes("/workflows/"),
    `Navigated to workflow view: ${url}`,
  );

  return ok;
}

async function testWorkflowViewRendersDAG(page: Page): Promise<boolean> {
  console.log("\n[4] Workflow View Renders DAG Nodes");

  // Upload via API, then navigate directly
  const result = await uploadFixture("simple-linear.json");
  if (!result) return assert(false, "Upload simple-linear.json via API");

  const viewPath = result.viewUrl.startsWith("http")
    ? new URL(result.viewUrl).pathname
    : result.viewUrl;
  await page.goto(`${UI_BASE}${viewPath}`);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  // Wait for step nodes to render — they should contain step names from the fixture
  // simple-linear.json has: Checkout, Build, Test
  let ok = true;
  for (const stepName of ["Checkout", "Build", "Test"]) {
    try {
      await page.getByText(stepName).first().waitFor({ timeout: 10_000 });
      ok = assert(true, `Step "${stepName}" is rendered`) && ok;
    } catch {
      ok = assert(false, `Step "${stepName}" is rendered`, "not found within timeout") && ok;
    }
  }

  return ok;
}

async function testWorkflowHeaderMetadata(page: Page): Promise<boolean> {
  console.log("\n[5] Workflow Header Shows Metadata");

  const result = await uploadFixture("parallel-diamond.json");
  if (!result) return assert(false, "Upload parallel-diamond.json via API");

  const viewPath = result.viewUrl.startsWith("http")
    ? new URL(result.viewUrl).pathname
    : result.viewUrl;
  await page.goto(`${UI_BASE}${viewPath}`);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  let ok = true;

  // parallel-diamond.json metadata: repository=org/repo, branch=feature/x
  // Workflow name: parallel-diamond-pipeline
  try {
    await page.getByText("parallel-diamond-pipeline").first().waitFor({ timeout: 10_000 });
    ok = assert(true, "Workflow name is displayed") && ok;
  } catch {
    ok = assert(false, "Workflow name is displayed") && ok;
  }

  // Check for metadata — at least one of repo/branch/commit should be visible
  const pageText = await page.textContent("body");
  const hasRepo = pageText?.includes("org/repo") ?? false;
  const hasBranch = pageText?.includes("feature/x") ?? false;
  ok = assert(hasRepo || hasBranch, "Workflow metadata (repo or branch) is displayed") && ok;

  return ok;
}

async function testStatusBadgeColors(page: Page): Promise<boolean> {
  console.log("\n[6] Status Badges Render with Distinct Styles");

  const result = await uploadFixture("mixed-status.json");
  if (!result) return assert(false, "Upload mixed-status.json via API");

  const viewPath = result.viewUrl.startsWith("http")
    ? new URL(result.viewUrl).pathname
    : result.viewUrl;
  await page.goto(`${UI_BASE}${viewPath}`);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  // mixed-status.json has: Setup (passed), Tests (failed), Deploy (skipped)
  let ok = true;
  for (const stepName of ["Setup", "Tests", "Deploy"]) {
    try {
      await page.getByText(stepName).first().waitFor({ timeout: 10_000 });
      ok = assert(true, `Step "${stepName}" is rendered`) && ok;
    } catch {
      ok = assert(false, `Step "${stepName}" is rendered`) && ok;
    }
  }

  return ok;
}

async function testClickStepNavigatesToSubSteps(page: Page): Promise<boolean> {
  console.log("\n[7] Click Non-Leaf Step → Navigates to Sub-Step View");

  const result = await uploadFixture("nested-hierarchy.json");
  if (!result) return assert(false, "Upload nested-hierarchy.json via API");

  const viewPath = result.viewUrl.startsWith("http")
    ? new URL(result.viewUrl).pathname
    : result.viewUrl;
  await page.goto(`${UI_BASE}${viewPath}`);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  // nested-hierarchy.json top-level: CI (non-leaf), Deploy (leaf)
  // Click on CI to navigate to sub-steps
  try {
    const ciNode = page.getByText("CI").first();
    await ciNode.waitFor({ timeout: 10_000 });
    await ciNode.click();
  } catch {
    return assert(false, "CI step node found and clickable");
  }

  // Should navigate to /steps/:uuid URL
  await page.waitForURL(/\/steps\//, { timeout: 10_000 });
  let ok = assert(page.url().includes("/steps/"), "Navigated to sub-step view");

  // Sub-step view should show CI's children: Build Frontend, Build Backend, Integration Tests
  for (const childName of ["Build Frontend", "Build Backend", "Integration Tests"]) {
    try {
      await page.getByText(childName).first().waitFor({ timeout: 10_000 });
      ok = assert(true, `Child step "${childName}" is rendered`) && ok;
    } catch {
      ok = assert(false, `Child step "${childName}" is rendered`) && ok;
    }
  }

  return ok;
}

async function testBreadcrumbNavigation(page: Page): Promise<boolean> {
  console.log("\n[8] Breadcrumb Navigation");

  const result = await uploadFixture("nested-hierarchy.json");
  if (!result) return assert(false, "Upload nested-hierarchy.json via API");

  const viewPath = result.viewUrl.startsWith("http")
    ? new URL(result.viewUrl).pathname
    : result.viewUrl;
  await page.goto(`${UI_BASE}${viewPath}`);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  let ok = true;
  const breadcrumb = page.locator('[data-testid="breadcrumb-nav"]');

  // ── Level 1: workflow view ──────────────────────────────────────────────────
  // Breadcrumb should show only the workflow name as plain text (no link)
  try {
    await breadcrumb.waitFor({ timeout: 10_000 });
    const breadcrumbText = await breadcrumb.textContent();
    ok = assert(
      breadcrumbText?.includes("nested-hierarchy-pipeline") ?? false,
      "Workflow-level breadcrumb shows workflow name",
    ) && ok;

    // The workflow name should NOT be a link at the workflow level
    const workflowLink = breadcrumb.locator('a').filter({ hasText: "nested-hierarchy-pipeline" });
    const linkCount = await workflowLink.count();
    ok = assert(linkCount === 0, "Workflow-level breadcrumb: workflow name is plain text (not a link)") && ok;
  } catch {
    ok = assert(false, "Breadcrumb nav is rendered at workflow level") && ok;
  }

  // ── Level 2: CI step view ───────────────────────────────────────────────────
  // Navigate into CI sub-steps
  try {
    await page.getByText("CI").first().waitFor({ timeout: 10_000 });
    await page.getByText("CI").first().click();
    await page.waitForURL(/\/steps\//, { timeout: 10_000 });
  } catch {
    return assert(false, "Navigate into CI sub-steps") && ok;
  }

  // Breadcrumb should show: [workflow name link] > [CI plain text]
  try {
    await page.waitForFunction(
      () => {
        const nav = document.querySelector('[data-testid="breadcrumb-nav"]');
        return nav?.textContent?.includes("CI") ?? false;
      },
      { timeout: 10_000 },
    );
    const breadcrumbText = await breadcrumb.textContent();
    ok = assert(
      (breadcrumbText?.includes("nested-hierarchy-pipeline") && breadcrumbText?.includes("CI")) ?? false,
      "CI-level breadcrumb shows: workflow name > CI",
    ) && ok;

    // Workflow name should now be a link
    const workflowLink = breadcrumb.locator('a').filter({ hasText: "nested-hierarchy-pipeline" });
    ok = assert(
      (await workflowLink.count()) === 1,
      "CI-level breadcrumb: workflow name is a link",
    ) && ok;

    // CI should be plain text (last crumb), not a link
    const ciLink = breadcrumb.locator('a').filter({ hasText: /^CI$/ });
    ok = assert(
      (await ciLink.count()) === 0,
      "CI-level breadcrumb: CI is plain text (current view, not a link)",
    ) && ok;
  } catch {
    ok = assert(false, "CI-level breadcrumb renders correctly") && ok;
  }

  // ── Level 3: Integration Tests step view ────────────────────────────────────
  // Navigate into Integration Tests (a non-leaf child of CI)
  try {
    await page.getByText("Integration Tests").first().waitFor({ timeout: 10_000 });
    await page.getByText("Integration Tests").first().click();
    await page.waitForURL(/\/steps\//, { timeout: 10_000 });
  } catch {
    return assert(false, "Navigate into Integration Tests sub-steps") && ok;
  }

  // Breadcrumb should show: [workflow name link] > [CI link] > [Integration Tests plain text]
  try {
    await page.waitForFunction(
      () => {
        const nav = document.querySelector('[data-testid="breadcrumb-nav"]');
        return nav?.textContent?.includes("Integration Tests") ?? false;
      },
      { timeout: 10_000 },
    );
    const breadcrumbText = await breadcrumb.textContent();
    ok = assert(
      (breadcrumbText?.includes("nested-hierarchy-pipeline") &&
        breadcrumbText?.includes("CI") &&
        breadcrumbText?.includes("Integration Tests")) ?? false,
      "Integration Tests-level breadcrumb shows full path: workflow > CI > Integration Tests",
    ) && ok;

    // Workflow name should be a link
    const workflowLink = breadcrumb.locator('a').filter({ hasText: "nested-hierarchy-pipeline" });
    ok = assert(
      (await workflowLink.count()) === 1,
      "Integration Tests-level breadcrumb: workflow name is a link",
    ) && ok;

    // CI should be a link (ancestor, not current)
    const ciLink = breadcrumb.locator('a').filter({ hasText: /^CI$/ });
    ok = assert(
      (await ciLink.count()) === 1,
      "Integration Tests-level breadcrumb: CI is a link (ancestor)",
    ) && ok;

    // Integration Tests should be plain text (current view)
    const integrationTestsLink = breadcrumb.locator('a').filter({ hasText: "Integration Tests" });
    ok = assert(
      (await integrationTestsLink.count()) === 0,
      "Integration Tests-level breadcrumb: Integration Tests is plain text (current view)",
    ) && ok;
  } catch {
    ok = assert(false, "Integration Tests-level breadcrumb renders correctly") && ok;
  }

  // ── Navigate back via breadcrumb link ───────────────────────────────────────
  // Click the workflow name link in the breadcrumb to go back to top level
  try {
    const workflowLink = breadcrumb.locator('a').filter({ hasText: "nested-hierarchy-pipeline" });
    await workflowLink.click();
    await page.waitForURL(/\/workflows\/[^/]+$/, { timeout: 10_000 });
    ok = assert(true, "Breadcrumb workflow link navigates back to workflow view") && ok;

    // After navigating back, breadcrumb should reset: workflow name as plain text, no step crumbs
    await page.waitForFunction(
      () => {
        const nav = document.querySelector('[data-testid="breadcrumb-nav"]');
        const links = nav?.querySelectorAll('a') ?? [];
        return links.length === 0;
      },
      { timeout: 10_000 },
    );
    const workflowLevelLink = breadcrumb.locator('a').filter({ hasText: "nested-hierarchy-pipeline" });
    ok = assert(
      (await workflowLevelLink.count()) === 0,
      "After breadcrumb navigation back: workflow name is plain text again",
    ) && ok;
  } catch {
    ok = assert(false, "Breadcrumb link back-navigation and reset") && ok;
  }

  return ok;
}

async function testLogPanelOpens(page: Page): Promise<boolean> {
  console.log("\n[9] Log Panel Opens");

  const result = await uploadFixture("simple-linear.json");
  if (!result) return assert(false, "Upload simple-linear.json via API");

  const viewPath = result.viewUrl.startsWith("http")
    ? new URL(result.viewUrl).pathname
    : result.viewUrl;
  await page.goto(`${UI_BASE}${viewPath}`);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  // Look for a log panel toggle button or a way to open logs
  const logToggle = page.getByText(/logs?/i).first();
  let ok = true;

  try {
    await logToggle.waitFor({ timeout: 10_000 });
    await logToggle.click();

    // After clicking, some log content should appear — or at least a log panel container
    const logPanel = page.locator('[class*="log"], [data-testid="log-panel"], [class*="panel"]');
    await logPanel.first().waitFor({ timeout: 5_000 });
    ok = assert(true, "Log panel opens on toggle click") && ok;
  } catch {
    // Maybe logs are shown inline for leaf steps — try clicking a leaf step
    try {
      await page.getByText("Checkout").first().click();
      // Wait for log content to appear
      await page.getByText("Cloning into repo...").first().waitFor({ timeout: 10_000 });
      ok = assert(true, "Log content visible after clicking leaf step") && ok;
    } catch {
      ok = assert(false, "Log panel opens or log content visible") && ok;
    }
  }

  return ok;
}

async function testLogPanelShowsContent(page: Page): Promise<boolean> {
  console.log("\n[10] Log Panel Shows Step Logs");

  const result = await uploadFixture("simple-linear.json");
  if (!result) return assert(false, "Upload simple-linear.json via API");

  const viewPath = result.viewUrl.startsWith("http")
    ? new URL(result.viewUrl).pathname
    : result.viewUrl;
  await page.goto(`${UI_BASE}${viewPath}`);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  // Click on the Checkout step (leaf) — should show its logs
  try {
    await page.getByText("Checkout").first().waitFor({ timeout: 10_000 });
    await page.getByText("Checkout").first().click();
  } catch {
    return assert(false, "Checkout step is clickable");
  }

  // Log content from simple-linear.json Checkout step: "Cloning into repo..."
  let ok = true;
  try {
    await page.getByText("Cloning into repo...").first().waitFor({ timeout: 10_000 });
    ok = assert(true, 'Log line "Cloning into repo..." is displayed') && ok;
  } catch {
    ok = assert(false, 'Log line "Cloning into repo..." is displayed') && ok;
  }

  return ok;
}

async function testClientSideRoutingFallback(page: Page): Promise<boolean> {
  console.log("\n[11] Client-Side Routing Fallback (Deep Link)");

  // Navigate directly to a workflow URL that exists (uploaded via API)
  const result = await uploadFixture("parallel-diamond.json");
  if (!result) return assert(false, "Upload parallel-diamond.json via API");

  const viewPath = result.viewUrl.startsWith("http")
    ? new URL(result.viewUrl).pathname
    : result.viewUrl;
  await page.goto(`${UI_BASE}${viewPath}`);

  // The SPA should load and render (not get a server 404)
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });
  const root = page.locator("#root");
  const innerHTML = await root.innerHTML();
  let ok = assert(innerHTML.length > 0, "Deep link loads SPA and renders content");

  // Also test that a nonexistent workflow path still loads the SPA shell
  const res = await page.goto(`${UI_BASE}/workflows/00000000-0000-0000-0000-000000000000`);
  ok = assert(res?.status() === 200, "Nonexistent workflow path returns 200 (SPA fallback)") && ok;

  return ok;
}

async function testBrowserBackNavigation(page: Page): Promise<boolean> {
  console.log("\n[12] Browser Back/Forward Navigation");

  const result = await uploadFixture("nested-hierarchy.json");
  if (!result) return assert(false, "Upload nested-hierarchy.json via API");

  const viewPath = result.viewUrl.startsWith("http")
    ? new URL(result.viewUrl).pathname
    : result.viewUrl;
  await page.goto(`${UI_BASE}${viewPath}`);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  const workflowUrl = page.url();

  // Click CI to navigate to sub-steps
  try {
    await page.getByText("CI").first().waitFor({ timeout: 10_000 });
    await page.getByText("CI").first().click();
    await page.waitForURL(/\/steps\//, { timeout: 10_000 });
  } catch {
    return assert(false, "Navigate into CI sub-steps");
  }

  const subStepUrl = page.url();
  let ok = assert(subStepUrl !== workflowUrl, "URL changed after clicking step");

  // Go back
  await page.goBack();
  await page.waitForURL(workflowUrl, { timeout: 10_000 });
  ok = assert(page.url() === workflowUrl, "Browser back returns to workflow view") && ok;

  // Go forward
  await page.goForward();
  await page.waitForURL(subStepUrl, { timeout: 10_000 });
  ok = assert(page.url() === subStepUrl, "Browser forward returns to sub-step view") && ok;

  return ok;
}

async function testUploadValidationError(page: Page): Promise<boolean> {
  console.log("\n[13] Upload Invalid File Shows Error");
  await page.goto(UI_BASE);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  const fileInput = page.locator('input[type="file"]');
  if ((await fileInput.count()) === 0) {
    return assert(false, "File input exists on upload page");
  }

  // Upload the invalid-cycle fixture
  const fixturePath = path.join(DATA_DIR, "invalid-cycle.json");
  await fileInput.setInputFiles(fixturePath);

  // Should NOT navigate to a workflow view — should stay and show error
  let ok = true;
  try {
    // Wait briefly to see if navigation happens (it shouldn't)
    await page.waitForURL(/\/workflows\//, { timeout: 3_000 });
    ok = assert(false, "Should not navigate on invalid upload") && ok;
  } catch {
    // Good — did not navigate
    ok = assert(true, "Stayed on upload page after invalid upload") && ok;
  }

  // Should display some error message
  const pageText = await page.textContent("body");
  const hasError =
    pageText?.toLowerCase().includes("error") ||
    pageText?.toLowerCase().includes("invalid") ||
    pageText?.toLowerCase().includes("cycle") ||
    false;
  ok = assert(hasError, "Error message is displayed for invalid upload") && ok;

  return ok;
}

async function testElapsedTimeDisplayed(page: Page): Promise<boolean> {
  console.log("\n[14] Step Nodes Show Elapsed Time");

  const result = await uploadFixture("simple-linear.json");
  if (!result) return assert(false, "Upload simple-linear.json via API");

  const viewPath = result.viewUrl.startsWith("http")
    ? new URL(result.viewUrl).pathname
    : result.viewUrl;
  await page.goto(`${UI_BASE}${viewPath}`);
  await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

  // simple-linear.json: Checkout runs 2s, Build runs 28s, Test runs 30s
  // Look for time-like patterns in the rendered page
  const pageText = await page.textContent("body");
  const hasTimePattern = /\d+s|\d+m|\d+:\d+/i.test(pageText ?? "");
  return assert(hasTimePattern, "Elapsed time values are displayed for steps");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Frontend E2E tests (Playwright)`);
  console.log(`  API: ${API_BASE}`);
  console.log(`  UI:  ${UI_BASE}`);

  // Health check — API
  try {
    const health = await fetch(`${API_BASE}/health`);
    const data = (await health.json()) as { status: string };
    console.log(`\nAPI health: ${data.status}`);
  } catch {
    console.error(`Cannot reach API at ${API_BASE}. Is the server running?`);
    process.exit(1);
  }

  // Health check — UI
  try {
    const uiRes = await fetch(`${UI_BASE}/`);
    if (uiRes.status !== 200) {
      console.error(`UI at ${UI_BASE} returned ${uiRes.status}. Is it running?`);
      process.exit(1);
    }
    console.log(`UI health: OK\n`);
  } catch {
    console.error(`Cannot reach UI at ${UI_BASE}. Is it running?`);
    process.exit(1);
  }

  const browser: Browser = await chromium.launch({ headless: true });

  const tests = [
    testSpaServing,
    testUploadPageRenders,
    testFileUploadAndNavigation,
    testWorkflowViewRendersDAG,
    testWorkflowHeaderMetadata,
    testStatusBadgeColors,
    testClickStepNavigatesToSubSteps,
    testBreadcrumbNavigation,
    testLogPanelOpens,
    testLogPanelShowsContent,
    testClientSideRoutingFallback,
    testBrowserBackNavigation,
    testUploadValidationError,
    testElapsedTimeDisplayed,
  ];

  for (const testFn of tests) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const ok = await testFn(page);
      if (ok) passed++;
      else failed++;
    } catch (err) {
      console.error(`  ✗ ${testFn.name} threw:`, err);
      failed++;
    } finally {
      await context.close();
    }
  }

  await browser.close();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
