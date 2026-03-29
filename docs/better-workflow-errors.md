# Better Workflow Upload Error Messages

Technical implementation plan for richer validation error messages when uploading workflow JSON.

## Current State

**Server** (`workflow-server/src/routes/workflows.ts`):

- Invalid JSON → `{ error: "Invalid JSON" }` (no details)
- Schema failure → `{ error: <raw Zod message>, details: <raw Zod issues array> }` (verbose, unformatted, no field paths)
- Structural failure → `{ error: "STRUCTURAL_INVALID", details: <single string> }` (only first error, no path)

**Frontend** (`ui/src/lib/api.ts`):

- `extractDetails()` pulls `.message` from each Zod issue but discards `.path`, `.code`, and `.expected`/`.received`
- `UploadForm.tsx` renders a flat bullet list of strings — no field-path context, no truncation

**Problems**:

1. Zod's raw `.message` is cryptic (e.g. `"Required"` with no indication of _which_ field)
2. No JSON line-number information for the offending fields
3. If many fields are wrong, the user sees a wall of errors
4. Structural errors (`validateStructureAndDAG`) bail on the first problem — no aggregation
5. Invalid-JSON errors give no position information (e.g. line/column of syntax error)

---

## Proposed Changes

### 1. Server: Format Zod Schema Errors (`workflow-server/src/lib/validation.ts`)

Add a new exported function `formatSchemaErrors` that transforms raw Zod issues into user-friendly strings with field paths, and caps the displayed count.

```ts
export interface FormattedValidationError {
  /** Human-readable summary, e.g. "3 validation errors (showing first 3)" */
  summary: string;
  /** Individual error strings with field paths, e.g. "workflow.steps[0].status: Invalid enum value. Expected 'passed' | 'failed' | ..., received 'done'" */
  items: string[];
  /** Total number of errors (may exceed items.length) */
  totalErrors: number;
}

const MAX_DISPLAYED_ERRORS = 3;

export function formatSchemaErrors(
  zodError: z.ZodError,
  rawJson?: string,
): FormattedValidationError {
  const issues = zodError.issues;
  const total = issues.length;
  const shown = issues.slice(0, MAX_DISPLAYED_ERRORS);

  const items = shown.map((issue) => {
    // Build dotted path: "workflow.steps[0].metadata.name"
    const fieldPath = issue.path
      .map((seg, i) =>
        typeof seg === "number" ? `[${seg}]` : (i > 0 ? "." : "") + seg,
      )
      .join("");

    let msg = issue.message;

    // Enrich enum errors with expected values
    if (issue.code === "invalid_enum_value") {
      const expected = (issue as any).options?.join(" | ");
      if (expected) msg += `. Expected: ${expected}`;
    }

    // Add line number if raw JSON is available
    const lineInfo = rawJson ? findLineForPath(rawJson, issue.path) : null;
    const linePrefix = lineInfo ? ` (line ${lineInfo})` : "";

    return `${fieldPath || "(root)"}${linePrefix}: ${msg}`;
  });

  const hiddenCount = total - shown.length;
  const summary =
    total === 1
      ? "1 validation error"
      : hiddenCount > 0
        ? `${total} validation errors (showing first ${MAX_DISPLAYED_ERRORS}; ${hiddenCount} more)`
        : `${total} validation errors`;

  return { summary, items, totalErrors: total };
}
```

#### Line-Number Resolution (`findLineForPath`)

Add a lightweight helper that walks the raw JSON string to find the approximate line number for a given Zod path. This does _not_ require a full JSON parser — it uses a simple approach:

```ts
/**
 * Walk the raw JSON text to locate the approximate line of a field path.
 * Uses a simple key-scanning heuristic (not a full parser) so it is
 * best-effort — returns null if the path can't be resolved.
 */
function findLineForPath(
  rawJson: string,
  path: (string | number)[],
): number | null {
  // Strategy: build a regex/search pattern from the path segments and
  // search for each key sequentially in the raw text, tracking line offsets.
  let offset = 0;
  for (const segment of path) {
    if (typeof segment === "string") {
      // Find the next occurrence of "key": after the current offset
      const pattern = `"${segment}"`;
      const idx = rawJson.indexOf(pattern, offset);
      if (idx === -1) return null;
      offset = idx + pattern.length;
    } else {
      // Array index: skip past `segment` number of array element openings
      // (look for commas / opening braces at the current nesting level)
      // For simplicity, advance offset past the next value opening
      let count = 0;
      while (count <= segment && offset < rawJson.length) {
        const ch = rawJson[offset];
        if (ch === "{" || ch === "[" || ch === '"') {
          if (count === segment) break;
          // Skip this value
          offset = skipJsonValue(rawJson, offset);
          count++;
        } else {
          offset++;
        }
      }
      if (offset >= rawJson.length) return null;
    }
  }
  // Count newlines up to offset
  return rawJson.slice(0, offset).split("\n").length;
}
```

`skipJsonValue` is a small helper that advances past a single JSON value (string, object, array, literal) by tracking nesting depth. This keeps the implementation self-contained without pulling in a streaming JSON parser.

### 2. Server: Improve Structural Error Reporting (`workflow-server/src/lib/validation.ts`)

Change `validateStructureAndDAG` (and its recursive helper) to collect _multiple_ structural errors instead of returning on the first one.

```ts
export function validateStructureAndDAG(
  input: WorkflowInput,
): FormattedValidationError | null {
  const ctx: ValidationContext = { totalLogBytes: 0, totalSteps: 0 };
  const errors: string[] = [];
  validateStepsRecursive(input.workflow.steps, 1, ctx, errors);

  if (errors.length === 0) return null;

  const shown = errors.slice(0, MAX_DISPLAYED_ERRORS);
  const hidden = errors.length - shown.length;
  return {
    summary:
      errors.length === 1
        ? "1 structural error"
        : hidden > 0
          ? `${errors.length} structural errors (showing first ${MAX_DISPLAYED_ERRORS}; ${hidden} more)`
          : `${errors.length} structural errors`,
    items: shown,
    totalErrors: errors.length,
  };
}
```

`validateStepsRecursive` changes from `returns string | null` to `void` — it pushes errors into the `errors` array and continues checking (with a hard cap, e.g. stop after 20 errors to avoid runaway processing).

### 3. Server: Update the Route Handler (`workflow-server/src/routes/workflows.ts`)

Pass the raw JSON text through to the formatter so line numbers can be resolved.

```ts
router.post("/", async (c) => {
  let rawText: string;
  try {
    rawText = await c.req.text();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch (err) {
    // Extract line/column from the native SyntaxError message
    const posMatch = String(err).match(/position (\d+)/i);
    const line = posMatch
      ? rawText.slice(0, Number(posMatch[1])).split("\n").length
      : null;
    return c.json(
      {
        error: "INVALID_JSON",
        summary: "The uploaded file is not valid JSON",
        details: [
          line
            ? `JSON syntax error near line ${line}: ${(err as Error).message}`
            : `JSON syntax error: ${(err as Error).message}`,
        ],
      },
      400,
    );
  }

  const parsed = workflowSchema.safeParse(body);
  if (!parsed.success) {
    const formatted = formatSchemaErrors(parsed.error, rawText);
    return c.json(
      {
        error: "SCHEMA_INVALID",
        summary: formatted.summary,
        details: formatted.items,
        totalErrors: formatted.totalErrors,
      },
      400,
    );
  }

  const structErr = validateStructureAndDAG(parsed.data);
  if (structErr) {
    return c.json(
      {
        error: "STRUCTURAL_INVALID",
        summary: structErr.summary,
        details: structErr.items,
        totalErrors: structErr.totalErrors,
      },
      400,
    );
  }

  // ... insert as before
});
```

**New unified error response shape** (all 400s):

```ts
{
  error: "INVALID_JSON" | "SCHEMA_INVALID" | "STRUCTURAL_INVALID";
  summary: string;        // Human-readable count, e.g. "3 validation errors (showing first 3; 2 more)"
  details: string[];      // Up to 3 individual error strings with field paths + line numbers
  totalErrors: number;    // Total count of errors found
}
```

### 4. Frontend: Update `extractDetails` (`ui/src/lib/api.ts`)

Update `ApiError` and `extractDetails` to carry the new `summary` and `totalErrors` fields.

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: string[],
    public summary?: string,
    public totalErrors?: number,
  ) {
    super(message);
  }
}

function extractApiError(body: Record<string, unknown>): {
  details?: string[];
  summary?: string;
  totalErrors?: number;
} {
  const result: { details?: string[]; summary?: string; totalErrors?: number } =
    {};

  // details: array of strings
  if (Array.isArray(body.details)) {
    result.details = body.details.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "message" in item)
        return String((item as Record<string, unknown>).message);
      return String(item);
    });
  } else if (body.details) {
    result.details = [String(body.details)];
  }

  if (typeof body.summary === "string") result.summary = body.summary;
  if (typeof body.totalErrors === "number")
    result.totalErrors = body.totalErrors;

  return result;
}
```

### 5. Frontend: Update `UploadForm.tsx`

Display the `summary` line above the detail bullets, and show a "+N more errors" note when truncated.

```tsx
{
  errors.length > 0 && (
    <div
      style={
        {
          /* ...existing red box styles... */
        }
      }
    >
      <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
        {errorSummary ?? "Upload error"}
      </div>
      <ul style={{ margin: 0, paddingLeft: "1.5rem" }}>
        {errors.map((e, i) => (
          <li key={i} style={{ fontSize: "0.875rem", fontFamily: "monospace" }}>
            {e}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

The detail items are already rendered as a list. The key UI changes:

- Use `summary` as the error box title instead of the static "Upload error" string
- Render detail items in a monospace font so field paths and line numbers are easy to read
- The "+N more" is already included in the `summary` from the server, so no extra frontend logic needed

---

## New Test Data Files

### `tests/data/invalid-schema-multiple.json`

A workflow with multiple schema violations to test error truncation and counting.

```json
{
  "workflow": {
    "metadata": { "name": "" },
    "steps": [
      {
        "id": "",
        "metadata": { "name": "" },
        "status": "done",
        "dependsOn": [],
        "logs": null,
        "steps": []
      },
      {
        "id": "step-2",
        "metadata": {},
        "status": 123,
        "dependsOn": "not-an-array",
        "logs": null,
        "steps": []
      }
    ]
  }
}
```

Errors expected:

1. `workflow.metadata.name`: String must contain at least 1 character(s)
2. `workflow.steps[0].id`: String must contain at least 1 character(s)
3. `workflow.steps[0].metadata.name`: String must contain at least 1 character(s)
4. `workflow.steps[0].status`: Invalid enum value (expected passed | failed | running | skipped | cancelled, received "done")
5. `workflow.steps[1].metadata.name`: Required
6. `workflow.steps[1].status`: Expected string, received number
7. `workflow.steps[1].dependsOn`: Expected array, received string

This gives 7+ errors — the response should show 3 and indicate "+4 more".

### `tests/data/invalid-structural-multiple.json`

A structurally valid schema but with multiple structural violations (cycle + excessive deps). Since structural validation runs _after_ schema validation, this file must pass schema validation first.

```json
{
  "workflow": {
    "metadata": { "name": "structural-multi-error" },
    "steps": [
      {
        "id": "a",
        "metadata": { "name": "A" },
        "status": "passed",
        "dependsOn": ["b"],
        "logs": null,
        "steps": []
      },
      {
        "id": "b",
        "metadata": { "name": "B" },
        "status": "passed",
        "dependsOn": ["a"],
        "logs": null,
        "steps": []
      }
    ]
  }
}
```

### `tests/data/invalid-json-syntax.json`

A JSON file with a specific syntax error at a known position (for testing line-number reporting).

```
{
  "workflow": {
    "metadata": { "name": "test" },
    "steps": [
      {
        "id": "step-1",
        "status": "passed"
        "metadata": { "name": "Step 1" }
      }
    ]
  }
}
```

Note: the missing comma after `"passed"` on line 7 creates a syntax error with a known line.

---

## Test Changes

### Backend Tests (`tests/e2e-tests-backend.ts`)

Add new tests within the existing `POST /api/workflows — invalid payloads` describe block:

```ts
test("invalid-json.json: returns INVALID_JSON with summary", async () => {
  const { status, json } = await post(
    "/api/workflows",
    readFixture("invalid-json.json"),
  );
  expect(status).toBe(400);
  const body = json as Record<string, unknown>;
  expect(body.error).toBe("INVALID_JSON");
  expect(body.summary).toBeString();
  expect(body.details).toBeArray();
  expect((body.details as string[]).length).toBeGreaterThanOrEqual(1);
});

test("invalid-json-syntax.json: returns line number in error detail", async () => {
  const { status, json } = await post(
    "/api/workflows",
    readFixture("invalid-json-syntax.json"),
  );
  expect(status).toBe(400);
  const body = json as Record<string, unknown>;
  expect(body.error).toBe("INVALID_JSON");
  const details = body.details as string[];
  // Should mention a line number
  expect(details[0]).toMatch(/line \d+/i);
});

test("invalid-schema.json: returns SCHEMA_INVALID with field paths", async () => {
  const { status, json } = await post(
    "/api/workflows",
    readFixture("invalid-schema.json"),
  );
  expect(status).toBe(400);
  const body = json as Record<string, unknown>;
  expect(body.error).toBe("SCHEMA_INVALID");
  expect(body.summary).toBeString();
  expect(body.details).toBeArray();
  // Details should contain dotted field paths
  const details = body.details as string[];
  expect(details[0]).toContain("workflow");
});

test("invalid-schema-multiple.json: caps at 3 details and reports total", async () => {
  const { status, json } = await post(
    "/api/workflows",
    readFixture("invalid-schema-multiple.json"),
  );
  expect(status).toBe(400);
  const body = json as Record<string, unknown>;
  expect(body.error).toBe("SCHEMA_INVALID");
  expect((body.details as string[]).length).toBeLessThanOrEqual(3);
  expect(body.totalErrors).toBeNumber();
  expect(body.totalErrors as number).toBeGreaterThan(3);
  // Summary should mention "more"
  expect((body.summary as string).toLowerCase()).toContain("more");
});

test("invalid-schema-multiple.json: details include line numbers", async () => {
  const { status, json } = await post(
    "/api/workflows",
    readFixture("invalid-schema-multiple.json"),
  );
  expect(status).toBe(400);
  const details = (json as Record<string, unknown>).details as string[];
  // At least one detail should include a line reference
  const hasLine = details.some((d) => /line \d+/.test(d));
  expect(hasLine).toBe(true);
});

test("invalid-cycle.json: returns STRUCTURAL_INVALID with summary", async () => {
  const { status, json } = await post(
    "/api/workflows",
    readFixture("invalid-cycle.json"),
  );
  expect(status).toBe(400);
  const body = json as Record<string, unknown>;
  expect(body.error).toBe("STRUCTURAL_INVALID");
  expect(body.summary).toBeString();
  expect(body.details).toBeArray();
  expect((body.details as string[]).length).toBeGreaterThanOrEqual(1);
});
```

Update existing tests to match new error codes:

- `invalid-json.json` test: assert `body.error === "INVALID_JSON"` (was unchecked)
- `invalid-schema.json` test: assert `body.error === "SCHEMA_INVALID"` (was just `toBeString()`)
- `invalid-cycle.json` test: already checks `"STRUCTURAL_INVALID"` — extend to also check `body.summary` and `body.details` array

### Frontend Tests (`tests/e2e-tests-frontend.ts`)

Add new tests or extend existing [13-15] tests:

```ts
describe("[13] Upload Workflow With Cycles Shows Error", () => {
  test("shows structural error summary and details", async () => {
    // ... existing setup: upload invalid-cycle.json ...

    // Verify the error box shows a summary (not just "Upload error")
    const errorBox = page
      .locator("div:has(> ul)")
      .filter({ hasText: /structural error/i });
    await errorBox.waitFor({ timeout: 10_000 });
    expect(await errorBox.isVisible()).toBe(true);

    // Verify at least one detail bullet mentions "Cycle"
    const bullets = errorBox.locator("li");
    const count = await bullets.count();
    expect(count).toBeGreaterThanOrEqual(1);
    const firstBullet = await bullets.first().textContent();
    expect(firstBullet?.toLowerCase()).toContain("cycle");
  });
});

describe("[15] Upload Invalid Workflow Schema Shows Error", () => {
  test("shows field path in error details", async () => {
    // ... existing setup: upload invalid-schema.json ...

    // Verify a detail bullet contains a field path like "workflow."
    const errorBox = page
      .locator("div:has(> ul)")
      .filter({ hasText: /validation error/i });
    await errorBox.waitFor({ timeout: 10_000 });

    const bullets = errorBox.locator("li");
    const firstBullet = await bullets.first().textContent();
    expect(firstBullet).toContain("workflow");
  });
});

describe("[15.1] Upload Schema With Multiple Errors Shows Truncated List", () => {
  test("shows at most 3 error details and a 'more' indicator", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(UPLOAD_URL);
      await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(
        path.join(DATA_DIR, "invalid-schema-multiple.json"),
      );

      // Wait for error display
      const errorBox = page
        .locator("div:has(> ul)")
        .filter({ hasText: /error/i });
      await errorBox.waitFor({ timeout: 10_000 });

      // Should show at most 3 bullet items
      const bullets = errorBox.locator("li");
      const count = await bullets.count();
      expect(count).toBeLessThanOrEqual(3);
      expect(count).toBeGreaterThanOrEqual(1);

      // Summary should mention "more" since total > 3
      const summaryText = await errorBox.locator("div").first().textContent();
      expect(summaryText?.toLowerCase()).toContain("more");
    } finally {
      await ctx.close();
    }
  });
});

describe("[14.1] Upload JSON Syntax Error Shows Line Number", () => {
  test("shows line number in error detail", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(UPLOAD_URL);
      await page.waitForSelector("#root:not(:empty)", { timeout: 10_000 });

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(
        path.join(DATA_DIR, "invalid-json-syntax.json"),
      );

      const errorBox = page
        .locator("div:has(> ul)")
        .filter({ hasText: /error/i });
      await errorBox.waitFor({ timeout: 10_000 });

      const bullet = errorBox.locator("li").first();
      const text = await bullet.textContent();
      expect(text).toMatch(/line \d+/i);
    } finally {
      await ctx.close();
    }
  });
});
```

---

## Summary of All Changes

| File                                          | Change                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workflow-server/src/lib/validation.ts`       | Add `formatSchemaErrors()`, `findLineForPath()`, `skipJsonValue()`. Refactor `validateStructureAndDAG` to collect multiple errors and return `FormattedValidationError`.                                     |
| `workflow-server/src/routes/workflows.ts`     | Read raw text first, parse manually, use `formatSchemaErrors()` for schema errors. Unify all 400 responses to `{ error, summary, details, totalErrors }` shape. Extract line/column from JSON `SyntaxError`. |
| `ui/src/lib/api.ts`                           | Add `summary` and `totalErrors` to `ApiError`. Update `extractDetails` → `extractApiError`.                                                                                                                  |
| `ui/src/components/UploadForm.tsx`            | Use `summary` as error box title. Apply monospace font to detail items.                                                                                                                                      |
| `tests/data/invalid-schema-multiple.json`     | New: workflow with 7+ schema violations                                                                                                                                                                      |
| `tests/data/invalid-json-syntax.json`         | New: JSON with missing comma at known line                                                                                                                                                                   |
| `tests/data/invalid-structural-multiple.json` | New: workflow with cycle (structural error)                                                                                                                                                                  |
| `tests/e2e-tests-backend.ts`                  | 6 new tests + update 3 existing tests for new error shape                                                                                                                                                    |
| `tests/e2e-tests-frontend.ts`                 | 2 new test describes ([14.1], [15.1]) + extend [13] and [15]                                                                                                                                                 |

### Error Categories After Changes

| Error Type       | `error` Code         | When                  | Example Detail                                                                                                         |
| ---------------- | -------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Malformed JSON   | `INVALID_JSON`       | `JSON.parse()` fails  | `JSON syntax error near line 7: Expected ',' or '}'`                                                                   |
| Schema mismatch  | `SCHEMA_INVALID`     | Zod validation fails  | `workflow.steps[0].status (line 8): Invalid enum value. Expected: passed \| failed \| running \| skipped \| cancelled` |
| Structural issue | `STRUCTURAL_INVALID` | DAG/limit checks fail | `Cycle detected in dependsOn at depth 1`                                                                               |
