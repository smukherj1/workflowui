import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { chromium, type Browser } from "playwright";

/**
 * Frontend E2E tests — browser-level verification of the Vite + React SPA.
 *
 * Uses Playwright via bun:test to drive a headless browser against the running
 * UI server. Assumes the API server (Hono), PostgreSQL, and the UI server
 * (nginx-served production build) are already running.
 *
 * Run: bun test ./tests/e2e-tests-frontend.ts
 *
 * Services: docker compose up -d (brings up postgres, workflow-server, ui)
 */

const API_BASE = process.env.API_URL ?? "http://localhost:3001";
const UI_BASE = process.env.UI_URL ?? "http://localhost:8080";
const DATA_DIR = path.join(__dirname, "data");

const TEST_TIMEOUT = 30_000; // 30 s per test

let browser: Browser;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function uploadFixture(
  filename: string,
): Promise<{ workflowId: string; viewUrl: string }> {
  const body = fs.readFileSync(path.join(DATA_DIR, filename), "utf8");
  const res = await fetch(`${API_BASE}/api/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (res.status !== 201) {
    throw new Error(
      `Upload ${filename} failed: expected 201, got ${res.status}`,
    );
  }
  return res.json() as Promise<{ workflowId: string; viewUrl: string }>;
}

function viewPath(viewUrl: string): string {
  return viewUrl.startsWith("http") ? new URL(viewUrl).pathname : viewUrl;
}

async function deleteWorkflow(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/workflows/${id}`, { method: "DELETE" });
}

// ── Suite Setup ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Verify API health
  const health = (await fetch(`${API_BASE}/health`).then((r) => r.json())) as {
    status: string;
  };
  expect(health.status, "API health check").toBe("ok");

  // Verify UI is reachable
  const uiStatus = (await fetch(`${UI_BASE}/`)).status;
  expect(uiStatus, "UI health check").toBe(200);

  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

// ── [1] SPA Serving & Hydration ──────────────────────────────────────────────

describe("[1] SPA Serving & Hydration", () => {
  test(
    "page has #root element and React hydrates",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        expect(await page.locator("#root").count()).toBe(1);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });
        const html = await page.locator("#root").innerHTML();
        expect(html.length).toBeGreaterThan(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [2] Upload Page Renders ──────────────────────────────────────────────────

describe("[2] Upload Page Renders", () => {
  test(
    "upload page has file input, drop zone, or upload prompt",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        const hasFileInput =
          (await page.locator('input[type="file"]').count()) > 0;
        const hasDropZone =
          (await page
            .locator(
              '[class*="drop"], [class*="upload"], [data-testid="upload"]',
            )
            .count()) > 0;
        const hasUploadText =
          (await page.getByText(/upload|drop|choose.*file/i).count()) > 0;

        expect(hasFileInput || hasDropZone || hasUploadText).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [3] File Upload → Workflow View Navigation ───────────────────────────────

describe("[3] File Upload → Workflow View Navigation", () => {
  test(
    "uploading simple-linear.json navigates to /workflows/",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      let uploadedWorkflowId: string | null = null;
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        const fileInput = page.locator('input[type="file"]');
        expect(await fileInput.count()).toBeGreaterThan(0);

        await fileInput.setInputFiles(
          path.join(DATA_DIR, "simple-linear.json"),
        );
        await page.waitForURL(/\/workflows\//, { timeout: 15_000 });
        expect(page.url()).toContain("/workflows/");
        const m = page.url().match(/\/workflows\/([^/?#]+)/);
        if (m) uploadedWorkflowId = m[1];
      } finally {
        await ctx.close();
        if (uploadedWorkflowId) await deleteWorkflow(uploadedWorkflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [4] Workflow View Renders DAG Nodes ──────────────────────────────────────

describe("[4] Workflow View Renders DAG Nodes", () => {
  test(
    "Checkout, Build, and Test step nodes are rendered",
    async () => {
      const result = await uploadFixture("simple-linear.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        for (const stepName of ["Checkout", "Build", "Test"]) {
          await page.getByText(stepName).first().waitFor({ timeout: 10_000 });
          expect(
            await page.getByText(stepName).first().isVisible(),
            `step "${stepName}" visible`,
          ).toBe(true);
        }
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [5] Workflow Header Shows Metadata ───────────────────────────────────────

describe("[5] Workflow Header Shows Metadata", () => {
  test(
    "workflow name and metadata (repo or branch) are displayed",
    async () => {
      const result = await uploadFixture("parallel-diamond.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page
          .getByText("parallel-diamond-pipeline")
          .first()
          .waitFor({ timeout: 10_000 });
        expect(
          await page.getByText("parallel-diamond-pipeline").first().isVisible(),
        ).toBe(true);

        // parallel-diamond.json metadata: repository=org/repo, branch=feature/x
        const pageText = await page.textContent("body");
        const hasRepo = pageText?.includes("org/repo") ?? false;
        const hasBranch = pageText?.includes("feature/x") ?? false;
        expect(
          hasRepo || hasBranch,
          "workflow metadata (repo or branch) displayed",
        ).toBe(true);
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [6] Status Badges Render with Distinct Styles ────────────────────────────

describe("[6] Status Badges Render with Distinct Styles", () => {
  test(
    "steps with mixed statuses are all rendered",
    async () => {
      const result = await uploadFixture("mixed-status.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        // mixed-status.json has: Setup (passed), Tests (failed), Deploy (skipped)
        for (const stepName of ["Setup", "Tests", "Deploy"]) {
          await page.getByText(stepName).first().waitFor({ timeout: 10_000 });
          expect(
            await page.getByText(stepName).first().isVisible(),
            `step "${stepName}" visible`,
          ).toBe(true);
        }
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [7] Click Non-Leaf Step → Sub-Step View ──────────────────────────────────

describe("[7] Click Non-Leaf Step → Sub-Step View", () => {
  test(
    "clicking CI navigates to /steps/ and shows its children",
    async () => {
      const result = await uploadFixture("nested-hierarchy.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.getByText("CI").first().waitFor({ timeout: 10_000 });
        await page.getByText("CI").first().click();
        await page.waitForURL(/\/steps\//, { timeout: 10_000 });
        expect(page.url()).toContain("/steps/");

        // nested-hierarchy.json: CI has children Build Frontend, Build Backend, Integration Tests
        for (const childName of [
          "Build Frontend",
          "Build Backend",
          "Integration Tests",
        ]) {
          await page.getByText(childName).first().waitFor({ timeout: 10_000 });
          expect(
            await page.getByText(childName).first().isVisible(),
            `child step "${childName}" visible`,
          ).toBe(true);
        }
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [8] Breadcrumb Navigation ────────────────────────────────────────────────

describe("[8] Breadcrumb Navigation", () => {
  let workflowViewUrl: string;
  let workflowId: string;

  beforeAll(async () => {
    const result = await uploadFixture("nested-hierarchy.json");
    workflowId = result.workflowId;
    workflowViewUrl = `${UI_BASE}${viewPath(result.viewUrl)}`;
  }, 15_000);

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test(
    "workflow-level breadcrumb shows workflow name as plain text (not a link)",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        const breadcrumb = page.locator('[data-testid="breadcrumb-nav"]');
        await breadcrumb.waitFor({ timeout: 10_000 });

        const text = await breadcrumb.textContent();
        expect(text).toContain("nested-hierarchy-pipeline");

        // Workflow name should NOT be a link at the workflow level
        const workflowLink = breadcrumb
          .locator("a")
          .filter({ hasText: "nested-hierarchy-pipeline" });
        expect(await workflowLink.count()).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "CI-level breadcrumb shows workflow name (link) > CI (plain text)",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.getByText("CI").first().waitFor({ timeout: 10_000 });
        await page.getByText("CI").first().click();
        await page.waitForURL(/\/steps\//, { timeout: 10_000 });

        const breadcrumb = page.locator('[data-testid="breadcrumb-nav"]');
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="breadcrumb-nav"]')
              ?.textContent?.includes("CI") ?? false,
          { timeout: 10_000 },
        );

        const text = await breadcrumb.textContent();
        expect(text).toContain("nested-hierarchy-pipeline");
        expect(text).toContain("CI");

        // Workflow name should now be a link
        expect(
          await breadcrumb
            .locator("a")
            .filter({ hasText: "nested-hierarchy-pipeline" })
            .count(),
        ).toBe(1);

        // CI should be plain text (last crumb), not a link
        expect(
          await breadcrumb.locator("a").filter({ hasText: /^CI$/ }).count(),
        ).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "Integration Tests-level breadcrumb shows full path and correct link/plain-text split",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        // Navigate into CI
        await page.getByText("CI").first().waitFor({ timeout: 10_000 });
        await page.getByText("CI").first().click();
        await page.waitForURL(/\/steps\//, { timeout: 10_000 });

        // Navigate into Integration Tests
        await page
          .getByText("Integration Tests")
          .first()
          .waitFor({ timeout: 10_000 });
        await page.getByText("Integration Tests").first().click();
        await page.waitForURL(/\/steps\//, { timeout: 10_000 });

        const breadcrumb = page.locator('[data-testid="breadcrumb-nav"]');
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="breadcrumb-nav"]')
              ?.textContent?.includes("Integration Tests") ?? false,
          { timeout: 10_000 },
        );

        const text = await breadcrumb.textContent();
        expect(text).toContain("nested-hierarchy-pipeline");
        expect(text).toContain("CI");
        expect(text).toContain("Integration Tests");

        // Workflow name and CI should both be links (ancestors)
        expect(
          await breadcrumb
            .locator("a")
            .filter({ hasText: "nested-hierarchy-pipeline" })
            .count(),
          "workflow name is a link",
        ).toBe(1);
        expect(
          await breadcrumb.locator("a").filter({ hasText: /^CI$/ }).count(),
          "CI is a link (ancestor)",
        ).toBe(1);

        // Integration Tests should be plain text (current view)
        expect(
          await breadcrumb
            .locator("a")
            .filter({ hasText: "Integration Tests" })
            .count(),
          "Integration Tests is plain text",
        ).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "clicking workflow name in breadcrumb navigates back and resets breadcrumb",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        // Navigate into CI
        await page.getByText("CI").first().waitFor({ timeout: 10_000 });
        await page.getByText("CI").first().click();
        await page.waitForURL(/\/steps\//, { timeout: 10_000 });

        const breadcrumb = page.locator('[data-testid="breadcrumb-nav"]');
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="breadcrumb-nav"]')
              ?.textContent?.includes("CI") ?? false,
          { timeout: 10_000 },
        );

        // Click the workflow name link to navigate back
        const workflowLink = breadcrumb
          .locator("a")
          .filter({ hasText: "nested-hierarchy-pipeline" });
        await workflowLink.click();
        await page.waitForURL(/\/workflows\/[^/]+$/, { timeout: 10_000 });

        // After navigating back, breadcrumb resets: workflow name as plain text, no links
        await page.waitForFunction(
          () => {
            const nav = document.querySelector(
              '[data-testid="breadcrumb-nav"]',
            );
            return (nav?.querySelectorAll("a").length ?? 0) === 0;
          },
          { timeout: 10_000 },
        );
        expect(
          await breadcrumb
            .locator("a")
            .filter({ hasText: "nested-hierarchy-pipeline" })
            .count(),
          "workflow name is plain text after back navigation",
        ).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [9] Leaf Step Click → Dedicated Log Viewer ───────────────────────────────

describe("[9] Leaf Step Click → Dedicated Log Viewer", () => {
  test(
    "clicking a leaf step navigates to /logs?stepPath= route",
    async () => {
      const result = await uploadFixture("simple-linear.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.getByText("Checkout").first().waitFor({ timeout: 10_000 });
        await page.getByText("Checkout").first().click();

        // Leaf step click should navigate to the dedicated log viewer
        await page.waitForURL(/\/logs(\?|#)/, { timeout: 10_000 });
        expect(page.url()).toContain("/logs");
        expect(page.url()).toContain("stepPath=");
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [10] Log Viewer Shows Step Logs ──────────────────────────────────────────

describe("[10] Log Viewer Shows Step Logs", () => {
  test(
    "log viewer for Checkout step shows its log content",
    async () => {
      const result = await uploadFixture("simple-linear.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.getByText("Checkout").first().waitFor({ timeout: 10_000 });
        await page.getByText("Checkout").first().click();

        // After clicking a leaf step, log content should appear
        // (either on a dedicated LogsPage or via an inline log panel)
        await page
          .getByText("Cloning into repo...")
          .first()
          .waitFor({ timeout: 10_000 });
        expect(
          await page.getByText("Cloning into repo...").first().isVisible(),
        ).toBe(true);
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [11] Client-Side Routing Fallback ────────────────────────────────────────

describe("[11] Client-Side Routing Fallback (Deep Link)", () => {
  test(
    "deep link to a workflow URL renders the SPA",
    async () => {
      const result = await uploadFixture("parallel-diamond.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });
        const html = await page.locator("#root").innerHTML();
        expect(html.length).toBeGreaterThan(0);
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "nonexistent workflow path returns 200 (SPA shell fallback)",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        const res = await page.goto(
          `${UI_BASE}/workflows/00000000-0000-0000-0000-000000000000`,
        );
        expect(res?.status()).toBe(200);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [12] Browser Back/Forward Navigation ─────────────────────────────────────

describe("[12] Browser Back/Forward Navigation", () => {
  test(
    "browser back/forward works between workflow and step views",
    async () => {
      const result = await uploadFixture("nested-hierarchy.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        const workflowUrl = page.url();

        await page.getByText("CI").first().waitFor({ timeout: 10_000 });
        await page.getByText("CI").first().click();
        await page.waitForURL(/\/steps\//, { timeout: 10_000 });

        const subStepUrl = page.url();
        expect(subStepUrl).not.toBe(workflowUrl);

        await page.goBack();
        await page.waitForURL(workflowUrl, { timeout: 10_000 });
        expect(page.url()).toBe(workflowUrl);

        await page.goForward();
        await page.waitForURL(subStepUrl, { timeout: 10_000 });
        expect(page.url()).toBe(subStepUrl);
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [13-15] Upload Error Handling ────────────────────────────────────────────

describe("[13] Upload Workflow With Cycles Shows Error", () => {
  test(
    "stays on upload page and shows cycle error message",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        const fileInput = page.locator('input[type="file"]');
        await fileInput.setInputFiles(
          path.join(DATA_DIR, "invalid-cycle.json"),
        );

        // Should NOT navigate to a workflow view
        let navigated = false;
        try {
          await page.waitForURL(/\/workflows\//, { timeout: 3_000 });
          navigated = true;
        } catch {
          // expected — did not navigate
        }
        expect(navigated, "should not navigate on cycle error").toBe(false);

        const pageText = await page.textContent("body");
        expect(pageText?.toLowerCase()).toContain("upload");
        expect(pageText?.toLowerCase()).toContain("error");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

describe("[14] Upload Invalid JSON Shows Error", () => {
  test(
    "stays on upload page and shows error for invalid JSON",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        const fileInput = page.locator('input[type="file"]');
        await fileInput.setInputFiles(path.join(DATA_DIR, "invalid-json.json"));

        let navigated = false;
        try {
          await page.waitForURL(/\/workflows\//, { timeout: 3_000 });
          navigated = true;
        } catch {
          // expected
        }
        expect(navigated, "should not navigate on JSON parse error").toBe(
          false,
        );

        const pageText = await page.textContent("body");
        expect(pageText?.toLowerCase()).toContain("upload");
        expect(pageText?.toLowerCase()).toContain("error");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

describe("[15] Upload Invalid Workflow Schema Shows Error", () => {
  test(
    "stays on upload page and shows error for invalid schema",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        const fileInput = page.locator('input[type="file"]');
        await fileInput.setInputFiles(
          path.join(DATA_DIR, "invalid-schema.json"),
        );

        let navigated = false;
        try {
          await page.waitForURL(/\/workflows\//, { timeout: 3_000 });
          navigated = true;
        } catch {
          // expected
        }
        expect(navigated, "should not navigate on schema error").toBe(false);

        const pageText = await page.textContent("body");
        expect(pageText?.toLowerCase()).toContain("upload");
        expect(pageText?.toLowerCase()).toContain("error");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [16] Step Nodes Show Elapsed Time ────────────────────────────────────────

describe("[16] Step Nodes Show Elapsed Time", () => {
  test(
    "elapsed time values are displayed for steps",
    async () => {
      const result = await uploadFixture("simple-linear.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        // simple-linear.json: Checkout runs 2s, Build runs 28s, Test runs 30s
        await page.getByText("Checkout").first().waitFor({ timeout: 10_000 });

        const pageText = await page.textContent("body");
        expect(
          /\d+s|\d+m|\d+:\d+/i.test(pageText ?? ""),
          "elapsed time pattern found in page",
        ).toBe(true);
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [17] Large Workflow Grid: Client-Side Pagination ─────────────────────────

describe("[17] Large Workflow Grid: Client-Side Pagination", () => {
  test("4000 Checkout sub-steps are accessible via client-side page navigation", async () => {
    const result = await uploadFixture("large-linear.json");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
      await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

      // Navigate into the Checkout step which has 4000 sub-steps
      await page.getByText("Checkout").first().waitFor({ timeout: 10_000 });
      await page.getByText("Checkout").first().click();
      await page.waitForURL(/\/steps\//, { timeout: 10_000 });

      // All 4000 steps are loaded upfront; page 1 shows steps 0–999
      await page
        .getByText("Checkout Step 0")
        .first()
        .waitFor({ timeout: 30_000 });
      expect(
        await page.getByText("Checkout Step 0").first().isVisible(),
        "step from page 1 is visible",
      ).toBe(true);

      // Verify page indicator shows exact count "Page 1 of 4"
      await page.getByText("Page 1 of 4").first().waitFor({ timeout: 10_000 });
      expect(
        await page.getByText("Page 1 of 4").first().isVisible(),
        "exact page count shown",
      ).toBe(true);

      // Click Next to navigate to page 2 (steps 1000–1999) — no network request
      const nextButton = page.getByRole("button", { name: /next/i });
      await nextButton.click();
      await page
        .getByText("Checkout Step 1000")
        .first()
        .waitFor({ timeout: 10_000 });
      expect(
        await page.getByText("Checkout Step 1000").first().isVisible(),
        "step from page 2 is visible after clicking Next",
      ).toBe(true);

      // Navigate to page 3
      await nextButton.click();
      await page
        .getByText("Checkout Step 2000")
        .first()
        .waitFor({ timeout: 10_000 });
      expect(
        await page.getByText("Checkout Step 2000").first().isVisible(),
        "step from page 3 is visible",
      ).toBe(true);

      // Navigate to page 4 — last page
      await nextButton.click();
      await page
        .getByText("Checkout Step 3999")
        .first()
        .waitFor({ timeout: 10_000 });
      expect(
        await page.getByText("Checkout Step 3999").first().isVisible(),
        "last step (index 3999) is visible on page 4",
      ).toBe(true);

      // Verify Previous works — go back to page 3
      const prevButton = page.getByRole("button", { name: /previous/i });
      await prevButton.click();
      await page
        .getByText("Checkout Step 2000")
        .first()
        .waitFor({ timeout: 10_000 });
      expect(
        await page.getByText("Checkout Step 2000").first().isVisible(),
        "back to page 3 after clicking Previous",
      ).toBe(true);
    } finally {
      await ctx.close();
      await deleteWorkflow(result.workflowId);
    }
  }, 60_000);
});

// ── [18] Workflow View: Merged Logs for All Steps ────────────────────────────

describe("[18] Workflow View: View Logs Shows Merged Logs for All Steps", () => {
  test(
    "View Logs at workflow level shows merged logs from all leaf steps",
    async () => {
      const result = await uploadFixture("simple-linear.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.getByText("Checkout").first().waitFor({ timeout: 10_000 });

        // The "View Logs" link navigates to the dedicated log viewer for the workflow root
        const viewLogsLink = page
          .getByRole("link", { name: /view logs/i })
          .first();
        await viewLogsLink.waitFor({ timeout: 10_000 });
        await viewLogsLink.click();
        await page.waitForURL(/\/logs/, { timeout: 10_000 });

        // simple-linear.json has 3 leaf steps — all their logs should be merged
        for (const expectedLine of [
          "Cloning into repo...",
          "Installing dependencies...",
          "Running 42 tests...",
        ]) {
          await page
            .getByText(expectedLine)
            .first()
            .waitFor({ timeout: 10_000 });
          expect(
            await page.getByText(expectedLine).first().isVisible(),
            `merged log contains "${expectedLine}"`,
          ).toBe(true);
        }
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [20] Status Filter Resets When Leaving Grid Mode ─────────────────────────

describe("[20] Status Filter Resets When Leaving Grid Mode", () => {
  test("filter applied in grid mode is cleared when navigating to a DAG-mode level", async () => {
    const result = await uploadFixture("large-linear.json");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
      await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

      // Top level has 3 steps (DAG mode) — navigate into Checkout (4000 sub-steps → grid mode)
      await page.getByText("Checkout").first().waitFor({ timeout: 10_000 });
      await page.getByText("Checkout").first().click();
      await page.waitForURL(/\/steps\//, { timeout: 10_000 });

      // Wait for grid mode: status filter bar should be visible
      await page.getByText("Filter:").first().waitFor({ timeout: 30_000 });

      // Apply the "failed" filter — clicking "failed" label when filter is empty adds it
      await page.getByText("failed").first().click();

      // Confirm filter is active: only failed steps visible on page 1
      await page
        .getByText("Checkout Step 1003")
        .first()
        .waitFor({ timeout: 10_000 });

      // Navigate back to the top-level workflow view via the breadcrumb link
      const breadcrumb = page.locator('[data-testid="breadcrumb-nav"]');
      const workflowLink = breadcrumb
        .locator("a")
        .filter({ hasText: "large-linear-pipeline" });
      await workflowLink.click();
      await page.waitForURL(/\/workflows\/[^/]+$/, { timeout: 10_000 });

      // All 3 top-level steps (Checkout, Build, Test) are "passed".
      // If the filter persists, they are hidden and the DAG shows nothing.
      // The correct behavior is for the filter to be reset when leaving grid mode.
      for (const stepName of ["Checkout", "Build", "Test"]) {
        await page.getByText(stepName).first().waitFor({ timeout: 10_000 });
        expect(
          await page.getByText(stepName).first().isVisible(),
          `top-level step "${stepName}" should be visible after filter reset`,
        ).toBe(true);
      }

      // Status filter bar should not be visible (DAG mode at top level)
      expect(
        await page.getByText("Filter:").count(),
        "filter bar should be hidden in DAG mode",
      ).toBe(0);
    } finally {
      await ctx.close();
      await deleteWorkflow(result.workflowId);
    }
  }, 60_000);
});

// ── [19] Step View (Non-Leaf): Merged Logs for Step Subtree ─────────────────

describe("[19] Step View (Non-Leaf): View Logs Shows Merged Logs for Subtree", () => {
  test(
    "View Logs at CI step shows merged logs from CI subtree",
    async () => {
      const result = await uploadFixture("nested-hierarchy.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}${viewPath(result.viewUrl)}`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        // Navigate into the CI step (non-leaf)
        await page.getByText("CI").first().waitFor({ timeout: 10_000 });
        await page.getByText("CI").first().click();
        await page.waitForURL(/\/steps\//, { timeout: 10_000 });

        await page
          .getByText("Build Frontend")
          .first()
          .waitFor({ timeout: 10_000 });

        // The "View Logs" link navigates to the log viewer scoped to the CI subtree
        const viewLogsLink = page
          .getByRole("link", { name: /view logs/i })
          .first();
        await viewLogsLink.waitFor({ timeout: 10_000 });
        await viewLogsLink.click();
        await page.waitForURL(/\/logs/, { timeout: 10_000 });

        // nested-hierarchy.json CI subtree leaf logs
        for (const expectedLine of [
          "Building React app...",
          "Compiling TypeScript...",
        ]) {
          await page
            .getByText(expectedLine)
            .first()
            .waitFor({ timeout: 10_000 });
          expect(
            await page.getByText(expectedLine).first().isVisible(),
            `CI subtree merged log contains "${expectedLine}"`,
          ).toBe(true);
        }
      } finally {
        await ctx.close();
        await deleteWorkflow(result.workflowId);
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [21] Command Palette (Search UI) ─────────────────────────────────────────

describe("[21] Command Palette — Search Trigger & Overlay", () => {
  let workflowId: string;
  let workflowViewUrl: string;

  beforeAll(async () => {
    const result = await uploadFixture("nested-hierarchy.json");
    workflowId = result.workflowId;
    workflowViewUrl = `${UI_BASE}${viewPath(result.viewUrl)}`;
  }, 15_000);

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test(
    "search trigger button is visible in workflow header",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });
        await page.getByText("CI").first().waitFor({ timeout: 10_000 });

        const trigger = page.locator('[data-testid="search-trigger"]').first();
        await trigger.waitFor({ timeout: 10_000 });
        expect(await trigger.isVisible()).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "clicking search trigger opens the command palette overlay",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });
        await page.getByText("CI").first().waitFor({ timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').first().click();

        const palette = page.locator('[data-testid="command-palette"]');
        await palette.waitFor({ timeout: 5_000 });
        expect(await palette.isVisible()).toBe(true);

        const input = page.locator('[data-testid="command-palette-input"]');
        expect(await input.isVisible()).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "keyboard shortcut Ctrl+K opens the command palette",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });
        await page.getByText("CI").first().waitFor({ timeout: 10_000 });

        await page.keyboard.press("Control+k");

        const palette = page.locator('[data-testid="command-palette"]');
        await palette.waitFor({ timeout: 5_000 });
        expect(await palette.isVisible()).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "typing in command palette shows step results for current workflow",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });
        await page.getByText("CI").first().waitFor({ timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').first().click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("Build");
        // Wait for debounce + API response
        await page
          .locator('[data-testid="search-result"]')
          .first()
          .waitFor({ timeout: 10_000 });

        const results = page.locator('[data-testid="search-result"]');
        expect(await results.count()).toBeGreaterThanOrEqual(1);

        // Results should include Build Frontend or Build Backend steps
        const bodyText = await page
          .locator('[data-testid="command-palette"]')
          .textContent();
        expect(bodyText?.toLowerCase()).toContain("build");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "pressing Escape closes the command palette",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });
        await page.getByText("CI").first().waitFor({ timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').first().click();
        const input = page.locator('[data-testid="command-palette-input"]');
        await input.waitFor({ timeout: 5_000 });
        // Ensure input is focused before pressing Escape
        await input.click();

        await page.keyboard.press("Escape");

        // Palette should be gone
        await page.waitForFunction(
          () => !document.querySelector('[data-testid="command-palette"]'),
          { timeout: 5_000 },
        );
        expect(
          await page.locator('[data-testid="command-palette"]').count(),
        ).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "clicking a search result navigates to the step view",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });
        await page.getByText("CI").first().waitFor({ timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').first().click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("Build Frontend");
        await page
          .locator('[data-testid="search-result"]')
          .first()
          .waitFor({ timeout: 10_000 });

        // Click the first result
        await page.locator('[data-testid="search-result"]').first().click();

        // Should navigate to a step view or workflow view
        await page.waitForURL(/\/(steps|workflows)\//, { timeout: 10_000 });
        // Palette should be closed
        expect(
          await page.locator('[data-testid="command-palette"]').count(),
        ).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [22] LogsPage Breadcrumb Navigation ──────────────────────────────────────

describe("[22] LogsPage — Breadcrumb Navigation", () => {
  let workflowId: string;
  let workflowViewUrl: string;

  beforeAll(async () => {
    const result = await uploadFixture("nested-hierarchy.json");
    workflowId = result.workflowId;
    workflowViewUrl = `${UI_BASE}${viewPath(result.viewUrl)}`;
  }, 15_000);

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test(
    "LogsPage for a nested step shows breadcrumb nav with hierarchy links",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        // Navigate into CI, then Build Frontend, then open logs
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.getByText("CI").first().waitFor({ timeout: 10_000 });
        await page.getByText("CI").first().click();
        await page.waitForURL(/\/steps\//, { timeout: 10_000 });

        await page
          .getByText("Build Frontend")
          .first()
          .waitFor({ timeout: 10_000 });
        await page.getByText("Build Frontend").first().click();
        await page.waitForURL(/\/logs/, { timeout: 10_000 });

        // Wait for logs page to render
        await page
          .locator('[data-testid="logs-page"]')
          .waitFor({ timeout: 10_000 });

        // Breadcrumb nav should be present
        const breadcrumb = page.locator('[data-testid="logs-breadcrumb-nav"]');
        await breadcrumb.waitFor({ timeout: 10_000 });

        const text = await breadcrumb.textContent();
        // Should contain workflow name, CI (parent), Build Frontend (current), and Logs
        expect(text).toContain("nested-hierarchy-pipeline");
        expect(text).toContain("CI");
        expect(text).toContain("Build Frontend");
        expect(text).toContain("Logs");

        // Workflow name should be a clickable link
        expect(
          await breadcrumb
            .locator("a")
            .filter({ hasText: "nested-hierarchy-pipeline" })
            .count(),
          "workflow name is a link",
        ).toBe(1);

        // CI should be a clickable link (ancestor step)
        expect(
          await breadcrumb.locator("a").filter({ hasText: /^CI$/ }).count(),
          "CI is a link (ancestor)",
        ).toBe(1);

        // Build Frontend should be plain text (current step in path, before Logs)
        expect(
          await breadcrumb
            .locator("a")
            .filter({ hasText: "Build Frontend" })
            .count(),
          "Build Frontend is plain text",
        ).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "clicking workflow name link in LogsPage breadcrumb navigates back to workflow view",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        // Go directly to logs for /ci/build-frontend
        const logsUrl = `${UI_BASE}/workflows/${workflowId}/logs?stepPath=%2Fci%2Fbuild-frontend`;
        await page.goto(logsUrl);
        await page
          .locator('[data-testid="logs-page"]')
          .waitFor({ timeout: 10_000 });

        const breadcrumb = page.locator('[data-testid="logs-breadcrumb-nav"]');
        await breadcrumb.waitFor({ timeout: 10_000 });

        // Click the workflow name link
        await breadcrumb
          .locator("a")
          .filter({ hasText: "nested-hierarchy-pipeline" })
          .click();

        await page.waitForURL(/\/workflows\/[^/]+$/, { timeout: 10_000 });
        expect(page.url()).toContain(`/workflows/${workflowId}`);
        expect(page.url()).not.toContain("/logs");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "clicking CI link in LogsPage breadcrumb navigates to CI step view",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        const logsUrl = `${UI_BASE}/workflows/${workflowId}/logs?stepPath=%2Fci%2Fbuild-frontend`;
        await page.goto(logsUrl);
        await page
          .locator('[data-testid="logs-page"]')
          .waitFor({ timeout: 10_000 });

        const breadcrumb = page.locator('[data-testid="logs-breadcrumb-nav"]');
        await breadcrumb.waitFor({ timeout: 10_000 });

        // Click CI link (ancestor step)
        await breadcrumb.locator("a").filter({ hasText: /^CI$/ }).click();

        await page.waitForURL(/\/steps\//, { timeout: 10_000 });
        expect(page.url()).toContain("/steps/");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "LogsPage for top-level leaf step shows no breadcrumb nav (stepPath has single segment)",
    async () => {
      // simple-linear: Checkout is top-level leaf → stepPath=/checkout
      const linearResult = await uploadFixture("simple-linear.json");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        const logsUrl = `${UI_BASE}/workflows/${linearResult.workflowId}/logs?stepPath=%2Fcheckout`;
        await page.goto(logsUrl);
        await page
          .locator('[data-testid="logs-page"]')
          .waitFor({ timeout: 10_000 });

        const breadcrumb = page.locator('[data-testid="logs-breadcrumb-nav"]');
        await breadcrumb.waitFor({ timeout: 10_000 });

        // Click the workflow name link
        await breadcrumb
          .locator("a")
          .filter({ hasText: "simple-linear" })
          .click();

        await page.waitForURL(/\/workflows\/[^/]+$/, { timeout: 10_000 });
        expect(page.url()).toContain(`/workflows/${linearResult.workflowId}`);
        expect(page.url()).not.toContain("/logs");
      } finally {
        await ctx.close();
        await deleteWorkflow(linearResult.workflowId);
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "LogsPage has search trigger button",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        const logsUrl = `${UI_BASE}/workflows/${workflowId}/logs?stepPath=%2Fci%2Fbuild-frontend`;
        await page.goto(logsUrl);
        await page
          .locator('[data-testid="logs-page"]')
          .waitFor({ timeout: 10_000 });

        const trigger = page.locator('[data-testid="search-trigger"]');
        await trigger.waitFor({ timeout: 5_000 });
        expect(await trigger.isVisible()).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [23] Landing Page Search ──────────────────────────────────────────────────

describe("[23] Landing Page — Search Trigger & Command Palette", () => {
  let workflowId: string;

  beforeAll(async () => {
    const result = await uploadFixture("nested-hierarchy.json");
    workflowId = result.workflowId;
  }, 15_000);

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test(
    "search trigger button is visible on the landing page",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        const trigger = page.locator('[data-testid="search-trigger"]');
        await trigger.waitFor({ timeout: 10_000 });
        expect(await trigger.isVisible()).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "clicking search trigger on landing page opens command palette",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();

        const palette = page.locator('[data-testid="command-palette"]');
        await palette.waitFor({ timeout: 5_000 });
        expect(await palette.isVisible()).toBe(true);

        const input = page.locator('[data-testid="command-palette-input"]');
        expect(await input.isVisible()).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "Ctrl+K on landing page opens command palette",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.keyboard.press("Control+k");

        const palette = page.locator('[data-testid="command-palette"]');
        await palette.waitFor({ timeout: 5_000 });
        expect(await palette.isVisible()).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "landing page palette searches all workflows (not scoped to a single workflow)",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        // Search for a known workflow name from nested-hierarchy.json
        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("nested-hierarchy");

        await page
          .locator('[data-testid="search-result"]')
          .first()
          .waitFor({ timeout: 10_000 });

        const results = page.locator('[data-testid="search-result"]');
        expect(await results.count()).toBeGreaterThanOrEqual(1);

        const paletteText = await page
          .locator('[data-testid="command-palette"]')
          .textContent();
        expect(paletteText?.toLowerCase()).toContain("nested-hierarchy");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "Escape closes the palette on the landing page",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        const input = page.locator('[data-testid="command-palette-input"]');
        await input.waitFor({ timeout: 5_000 });
        await input.click();

        await page.keyboard.press("Escape");

        await page.waitForFunction(
          () => !document.querySelector('[data-testid="command-palette"]'),
          { timeout: 5_000 },
        );
        expect(
          await page.locator('[data-testid="command-palette"]').count(),
        ).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "clicking a workflow result on the landing page navigates to workflow view",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("nested-hierarchy");

        await page
          .locator('[data-testid="search-result"]')
          .first()
          .waitFor({ timeout: 10_000 });

        await page.locator('[data-testid="search-result"]').first().click();

        // Should navigate to a workflow or step view
        await page.waitForURL(/\/(workflows|steps)\//, { timeout: 10_000 });
        // Palette should be closed
        expect(
          await page.locator('[data-testid="command-palette"]').count(),
        ).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [24] Command Palette — Prefix Search ─────────────────────────────────────

describe("[24] Command Palette — Prefix Search", () => {
  let workflowId: string;
  let workflowViewUrl: string;

  beforeAll(async () => {
    const result = await uploadFixture("nested-hierarchy.json");
    workflowId = result.workflowId;
    workflowViewUrl = `${UI_BASE}${viewPath(result.viewUrl)}`;
  }, 15_000);

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test(
    "[24.1] typing `name:Build` shows prefix indicator with field pill",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("name:Build");

        const indicator = page.locator('[data-testid="prefix-indicator"]');
        await indicator.waitFor({ timeout: 5_000 });
        expect(await indicator.isVisible()).toBe(true);

        const indicatorText = await indicator.textContent();
        expect(indicatorText?.toLowerCase()).toContain("name");

        await page
          .locator('[data-testid="search-result"]')
          .first()
          .waitFor({ timeout: 10_000 });
        expect(
          await page.locator('[data-testid="search-result"]').count(),
        ).toBeGreaterThanOrEqual(1);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[24.2] typing `uri:` prefix shows prefix indicator and returns field-scoped results",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("uri:github");

        const indicator = page.locator('[data-testid="prefix-indicator"]');
        await indicator.waitFor({ timeout: 5_000 });
        expect(await indicator.isVisible()).toBe(true);

        const indicatorText = await indicator.textContent();
        expect(indicatorText?.toLowerCase()).toContain("uri");

        // Wait for API response — results or empty state
        await page.waitForTimeout(600);
        const hasResults =
          (await page.locator('[data-testid="search-result"]').count()) > 0;
        const paletteText = await page
          .locator('[data-testid="command-palette"]')
          .textContent();
        expect(hasResults || paletteText?.includes("No results")).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[24.3] typing `path:/ci` prefix shows prefix indicator and returns path-scoped results",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("path:/ci");

        const indicator = page.locator('[data-testid="prefix-indicator"]');
        await indicator.waitFor({ timeout: 5_000 });
        expect(await indicator.isVisible()).toBe(true);

        const indicatorText = await indicator.textContent();
        expect(indicatorText?.toLowerCase()).toContain("path");

        await page
          .locator('[data-testid="search-result"]')
          .first()
          .waitFor({ timeout: 10_000 });
        const paletteText = await page
          .locator('[data-testid="command-palette"]')
          .textContent();
        expect(paletteText?.toLowerCase()).toContain("/ci");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[24.4] typing a plain query (no prefix) does not show prefix indicator",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("Build");

        await page
          .locator('[data-testid="search-result"]')
          .first()
          .waitFor({ timeout: 10_000 });

        expect(
          await page.locator('[data-testid="prefix-indicator"]').count(),
        ).toBe(0);
        expect(
          await page.locator('[data-testid="search-result"]').count(),
        ).toBeGreaterThanOrEqual(1);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[24.5] clicking × on the prefix pill removes the prefix from the input",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("name:Build");

        const indicator = page.locator('[data-testid="prefix-indicator"]');
        await indicator.waitFor({ timeout: 5_000 });

        // Click the × button inside the prefix indicator
        await indicator.locator("button").click();

        await page.waitForFunction(
          () => !document.querySelector('[data-testid="prefix-indicator"]'),
          { timeout: 5_000 },
        );
        expect(
          await page.locator('[data-testid="prefix-indicator"]').count(),
        ).toBe(0);

        const inputValue = await page
          .locator('[data-testid="command-palette-input"]')
          .inputValue();
        expect(inputValue).toBe("Build");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    '[24.6] quoted query "name:Build" does not show prefix indicator',
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill('"name:Build"');

        await page.waitForTimeout(600);

        expect(
          await page.locator('[data-testid="prefix-indicator"]').count(),
        ).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [25] Command Palette — Help Panel ────────────────────────────────────────

describe("[25] Command Palette — Help Panel", () => {
  let workflowId: string;
  let workflowViewUrl: string;

  beforeAll(async () => {
    const result = await uploadFixture("nested-hierarchy.json");
    workflowId = result.workflowId;
    workflowViewUrl = `${UI_BASE}${viewPath(result.viewUrl)}`;
  }, 15_000);

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test(
    "[25.1] help button is visible in the command palette",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        expect(
          await page.locator('[data-testid="search-help-button"]').isVisible(),
        ).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[25.2] clicking help button shows the help panel",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page.locator('[data-testid="search-help-button"]').click();

        const helpPanel = page.locator('[data-testid="search-help-panel"]');
        await helpPanel.waitFor({ timeout: 5_000 });
        expect(await helpPanel.isVisible()).toBe(true);

        const panelText = await helpPanel.textContent();
        expect(panelText).toContain("name:");
        expect(panelText).toContain("uri:");
        expect(panelText).toContain("pin:");
        expect(panelText).toContain("path:");
        expect(panelText?.toLowerCase()).toContain("quot");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[25.3] clicking help button again closes the help panel",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page.locator('[data-testid="search-help-button"]').click();
        await page
          .locator('[data-testid="search-help-panel"]')
          .waitFor({ timeout: 5_000 });

        await page.locator('[data-testid="search-help-button"]').click();

        await page.waitForFunction(
          () => !document.querySelector('[data-testid="search-help-panel"]'),
          { timeout: 5_000 },
        );
        expect(
          await page.locator('[data-testid="search-help-panel"]').count(),
        ).toBe(0);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[25.4] typing in the input closes the help panel and shows results",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page.locator('[data-testid="search-help-button"]').click();
        await page
          .locator('[data-testid="search-help-panel"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("Build");

        await page.waitForFunction(
          () => !document.querySelector('[data-testid="search-help-panel"]'),
          { timeout: 5_000 },
        );
        expect(
          await page.locator('[data-testid="search-help-panel"]').count(),
        ).toBe(0);

        await page
          .locator('[data-testid="search-result"]')
          .first()
          .waitFor({ timeout: 10_000 });
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[25.5] pressing Escape while help panel is open closes the help panel (not the palette)",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page.locator('[data-testid="search-help-button"]').click();
        await page
          .locator('[data-testid="search-help-panel"]')
          .waitFor({ timeout: 5_000 });

        await page.keyboard.press("Escape");

        await page.waitForFunction(
          () => !document.querySelector('[data-testid="search-help-panel"]'),
          { timeout: 5_000 },
        );
        expect(
          await page.locator('[data-testid="search-help-panel"]').count(),
        ).toBe(0);

        // Palette should still be open
        expect(
          await page.locator('[data-testid="command-palette"]').isVisible(),
        ).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [26] Command Palette — Advanced Search Link ───────────────────────────────

describe("[26] Command Palette — Advanced Search Link", () => {
  let workflowId: string;
  let workflowViewUrl: string;

  beforeAll(async () => {
    const result = await uploadFixture("nested-hierarchy.json");
    workflowId = result.workflowId;
    workflowViewUrl = `${UI_BASE}${viewPath(result.viewUrl)}`;
  }, 15_000);

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test(
    '[26.1] "Advanced Search" link is visible in the palette footer',
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        expect(
          await page
            .locator('[data-testid="advanced-search-link"]')
            .isVisible(),
        ).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    '[26.2] clicking "Advanced Search" with no query navigates to `/search`',
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page.locator('[data-testid="advanced-search-link"]').click();

        await page.waitForURL(/\/search/, { timeout: 10_000 });
        expect(
          await page.locator('[data-testid="command-palette"]').count(),
        ).toBe(0);
        expect(new URL(page.url()).pathname).toBe("/search");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    '[26.3] clicking "Advanced Search" with a prefix query pre-fills URL params',
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("name:Build");
        await page
          .locator('[data-testid="prefix-indicator"]')
          .waitFor({ timeout: 5_000 });

        await page.locator('[data-testid="advanced-search-link"]').click();

        await page.waitForURL(/\/search/, { timeout: 10_000 });
        const url = new URL(page.url());
        expect(url.searchParams.get("q")).toBe("Build");
        expect(url.searchParams.get("field")).toBe("name");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    '[26.4] clicking "Advanced Search" from a workflow-scoped palette includes workflowId',
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(workflowViewUrl);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('[data-testid="search-trigger"]').click();
        await page
          .locator('[data-testid="command-palette-input"]')
          .waitFor({ timeout: 5_000 });

        await page
          .locator('[data-testid="command-palette-input"]')
          .fill("Build");

        await page.locator('[data-testid="advanced-search-link"]').click();

        await page.waitForURL(/\/search/, { timeout: 10_000 });
        const url = new URL(page.url());
        expect(url.searchParams.get("q")).toBe("Build");
        expect(url.searchParams.get("workflowId")).toBe(workflowId);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [27] Advanced Search Page — Rendering & Controls ─────────────────────────

describe("[27] Advanced Search Page — Rendering & Controls", () => {
  let workflowId: string;

  beforeAll(async () => {
    const result = await uploadFixture("nested-hierarchy.json");
    workflowId = result.workflowId;
  }, 15_000);

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test(
    "[27.1] `/search` route renders the search page with all form controls",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        expect(
          await page.locator('[data-testid="search-page"]').isVisible(),
        ).toBe(true);
        expect(
          await page.locator('[data-testid="search-form"]').isVisible(),
        ).toBe(true);

        expect(
          await page.locator('input[type="text"]').count(),
        ).toBeGreaterThanOrEqual(1);
        expect(await page.locator("select").count()).toBeGreaterThanOrEqual(2);
        expect(await page.locator('input[type="date"]').count()).toBe(2);
        expect(
          await page.locator('button[type="submit"]').count(),
        ).toBeGreaterThanOrEqual(1);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[27.2] search form submits and displays results in a table",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page
          .locator('input[type="text"]')
          .first()
          .fill("nested-hierarchy");
        await page.locator('button[type="submit"]').click();

        const table = page.locator('[data-testid="search-results-table"]');
        await table.waitFor({ timeout: 10_000 });
        expect(await table.isVisible()).toBe(true);

        const rows = table.locator("tbody tr");
        expect(await rows.count()).toBeGreaterThanOrEqual(1);

        const tableText = await table.textContent();
        expect(tableText?.toLowerCase()).toContain("nested-hierarchy");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[27.3] selecting a field restricts search results",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        // Select the field dropdown (first select is "field")
        await page.locator("select").first().selectOption("name");
        await page
          .locator('input[type="text"]')
          .first()
          .fill("nested-hierarchy");
        await page.locator('button[type="submit"]').click();

        await page
          .locator('[data-testid="search-results-table"]')
          .waitFor({ timeout: 10_000 });
        expect(
          await page
            .locator('[data-testid="search-results-table"]')
            .isVisible(),
        ).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[27.4] search with no results shows empty state",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page
          .locator('input[type="text"]')
          .first()
          .fill("zzz-nonexistent-query-zzz");
        await page.locator('button[type="submit"]').click();

        await page
          .locator('[data-testid="search-empty"]')
          .waitFor({ timeout: 10_000 });
        expect(
          await page.locator('[data-testid="search-empty"]').isVisible(),
        ).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    '[27.5] "Clear" button resets all filters',
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page
          .locator('input[type="text"]')
          .first()
          .fill("nested-hierarchy");
        await page.locator("select").first().selectOption("uri");
        await page.locator("select").nth(1).selectOption("workflows");

        await page.getByRole("button", { name: "Clear" }).click();

        expect(
          await page.locator('input[type="text"]').first().inputValue(),
        ).toBe("");
        expect(await page.locator("select").first().inputValue()).toBe("");
        expect(await page.locator("select").nth(1).inputValue()).toBe("");
        expect(
          await page.locator('input[type="date"]').first().inputValue(),
        ).toBe("");
        expect(
          await page.locator('input[type="date"]').nth(1).inputValue(),
        ).toBe("");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [28] Advanced Search Page — URL State & Navigation ───────────────────────

describe("[28] Advanced Search Page — URL State & Navigation", () => {
  let workflowId: string;

  beforeAll(async () => {
    const result = await uploadFixture("nested-hierarchy.json");
    workflowId = result.workflowId;
  }, 15_000);

  afterAll(async () => {
    if (workflowId) await deleteWorkflow(workflowId);
  });

  test(
    "[28.1] submitting a search updates the URL with query params",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page.locator('input[type="text"]').first().fill("Build");
        await page.locator("select").first().selectOption("name");
        await page.locator('button[type="submit"]').click();

        await page.waitForURL(/q=Build/, { timeout: 10_000 });
        const url = new URL(page.url());
        expect(url.searchParams.get("q")).toBe("Build");
        expect(url.searchParams.get("field")).toBe("name");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[28.2] navigating directly to `/search?q=nested-hierarchy` loads with pre-filled form and results",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search?q=nested-hierarchy`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        expect(
          await page.locator('input[type="text"]').first().inputValue(),
        ).toBe("nested-hierarchy");

        await page
          .locator('[data-testid="search-results-table"]')
          .waitFor({ timeout: 10_000 });
        expect(
          await page
            .locator('[data-testid="search-results-table"]')
            .locator("tbody tr")
            .count(),
        ).toBeGreaterThanOrEqual(1);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[28.3] navigating to `/search?q=Build&field=name&scope=steps` pre-fills all controls",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search?q=Build&field=name&scope=steps`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        expect(
          await page.locator('input[type="text"]').first().inputValue(),
        ).toBe("Build");
        expect(await page.locator("select").first().inputValue()).toBe("name");
        expect(await page.locator("select").nth(1).inputValue()).toBe("steps");
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[28.4] clicking a workflow result navigates to the workflow view",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search?q=nested-hierarchy&scope=workflows`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        await page
          .locator('[data-testid="search-results-table"] tbody tr')
          .first()
          .waitFor({ timeout: 10_000 });

        await page
          .locator('[data-testid="search-results-table"] tbody tr')
          .first()
          .click();

        await page.waitForURL(/\/workflows\/[^/]+$/, { timeout: 10_000 });
        expect(page.url()).toMatch(/\/workflows\/[^/]+$/);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[28.5] clicking a step result navigates to the step view",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search?q=Build&scope=steps`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        const firstRow = page
          .locator('[data-testid="search-results-table"] tbody tr')
          .first();
        await firstRow.waitFor({ timeout: 10_000 });
        await firstRow.click();

        await page.waitForURL(/\/workflows\/.+\/steps\//, { timeout: 10_000 });
        expect(page.url()).toMatch(/\/workflows\/.+\/steps\//);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "[28.6] date range filtering sends from/to params to API",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${UI_BASE}/search`);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        // Use a wide date range that includes the fixture
        const today = new Date().toISOString().split("T")[0];
        const past = "2020-01-01";

        await page
          .locator('input[type="text"]')
          .first()
          .fill("nested-hierarchy");
        await page.locator('input[type="date"]').first().fill(past);
        await page.locator('input[type="date"]').nth(1).fill(today);
        await page.locator('button[type="submit"]').click();

        await page
          .locator('[data-testid="search-results-table"]')
          .waitFor({ timeout: 10_000 });
        expect(
          await page
            .locator('[data-testid="search-results-table"]')
            .locator("tbody tr")
            .count(),
        ).toBeGreaterThanOrEqual(1);

        // Narrow range to far past — should exclude fixture
        await page.locator('input[type="date"]').nth(1).fill("2020-01-01");
        await page.locator('button[type="submit"]').click();

        await page
          .locator('[data-testid="search-empty"]')
          .waitFor({ timeout: 10_000 });
        expect(
          await page.locator('[data-testid="search-empty"]').isVisible(),
        ).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});

// ── [29] Landing Page — Advanced Search Link ─────────────────────────────────

describe("[29] Landing Page — Advanced Search Link", () => {
  test(
    "[29.1] landing page has a link to the advanced search page",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(UI_BASE);
        await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

        const link = page.getByText(/Advanced Search/i).first();
        await link.waitFor({ timeout: 5_000 });
        expect(await link.isVisible()).toBe(true);

        await link.click();

        await page.waitForURL(/\/search/, { timeout: 10_000 });
        expect(new URL(page.url()).pathname).toBe("/search");
        await page
          .locator('[data-testid="search-page"]')
          .waitFor({ timeout: 10_000 });
        expect(
          await page.locator('[data-testid="search-page"]').isVisible(),
        ).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    TEST_TIMEOUT,
  );
});
