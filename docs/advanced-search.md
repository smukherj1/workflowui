# Technical Design: Advanced Search

## Overview

This design extends the existing search functionality with two complementary interfaces:

1. **Enhanced Command Palette** — prefix syntax for field-scoped searches, visual feedback, help system, and a link to advanced search
2. **Dedicated Search Page** (`/search`) — full-featured search with form controls, date range filtering, and tabular results

The backend API (`GET /api/search`) already supports `field`, `from`, `to`, `scope`, and `workflowId` parameters. All changes in this design are frontend-only.

---

## Enhanced Command Palette

### Prefix Syntax

The command palette input accepts optional prefix qualifiers that map to the API's `field` parameter:

| Prefix  | API `field` value | Example input             |
| ------- | ----------------- | ------------------------- |
| `name:` | `name`            | `name:build-frontend`     |
| `uri:`  | `uri`             | `uri:github://org/repo`   |
| `pin:`  | `pin`             | `pin:abc123`              |
| `path:` | `path`            | `path:/ci/build-frontend` |

**Parsing rules:**

- A prefix is recognized only when the query starts with one of the four keywords followed by a colon (e.g., `name:`). Colons appearing elsewhere in the query (e.g., `github://org:repo`) are not treated as prefix delimiters.
- Everything after the prefix becomes the search term sent as `q` to the API.
- Leading/trailing whitespace in the search term is trimmed.
- If no prefix is present, the query searches across name, URI, and pin simultaneously (the existing default behavior).

**Quoting to escape prefix detection:**

If the user's search term itself starts with a prefix-like pattern (e.g., searching for a literal string `name:foo`), they can wrap the query in double quotes to bypass prefix parsing:

| Input              | Parsed as                                   |
| ------------------ | ------------------------------------------- |
| `name:frontend`    | field=`name`, q=`frontend`                  |
| `"name:frontend"`  | field=none, q=`name:frontend` (literal)     |
| `"uri:gcs://test"` | field=none, q=`uri:gcs://test` (literal)    |
| `frontend`         | field=none, q=`frontend` (default behavior) |

The outer double quotes are stripped and not included in the search term.

### Visual Prefix Indicator

Since parts of a native `<input>` element cannot be individually styled, the palette displays a visual indicator bar between the input and the results list when a prefix is detected:

```
┌─────────────────────────────────────────────────┐
│ 🔍  name:build-frontend                    [?]  │
│─────────────────────────────────────────────────│
│  [Field: name ×]  searching for "build-frontend"│
│─────────────────────────────────────────────────│
│  ● build-frontend         /ci/build    step     │
│  ● build-frontend-tests   /ci/test     step     │
└─────────────────────────────────────────────────┘
```

The indicator bar shows:

- A colored pill with the detected field label and an `×` button. Clicking `×` removes the prefix from the input text, reverting to an unscoped search.
- A dimmed text showing the actual search term being sent to the API: `searching for "..."`.

When no prefix is detected (including quoted queries), the indicator bar is not shown.

The pill color is a muted accent (e.g., blue/indigo) consistent with the palette's dark theme. The bar has `data-testid="prefix-indicator"`.

### Help Button

A `?` button appears to the right of the search input, after the loading indicator.

**Hover behavior:** A tooltip appears below/beside the button with the text: "Search help — supported prefixes and syntax". The tooltip uses `title` attribute or a lightweight CSS tooltip (no library dependency). The element has `data-testid="search-help-button"`.

**Click behavior:** Toggles a help popover panel that replaces the results area (not an additional overlay). The popover contains:

```
Search Prefixes
───────────────
  name:   Search by name           name:build
  uri:    Search by URI            uri:github://org
  pin:    Search by pin/version    pin:abc123
  path:   Search by hierarchy path path:/ci/build

Escaping
────────
  Wrap in double quotes to search literally:
  "name:foo" searches for the text name:foo

Tips
────
  • No prefix searches name, URI, and pin together
  • Within a workflow, search is scoped to its steps
  • Press Esc to close, ↑↓ to navigate results
```

Clicking `?` again, pressing Escape, or typing in the input closes the help panel and restores the results view. The help panel has `data-testid="search-help-panel"`.

### Advanced Search Link

The palette footer gains an "Advanced Search" link to the right of the existing keyboard hints:

```
↑↓ navigate  ↵ select  Esc close              Advanced Search →
```

Clicking it:

1. Closes the palette
2. Navigates to `/search`, pre-filling the current query and any detected prefix as URL parameters

If the palette has a `workflowId` context, it is also forwarded: `/search?q=build&field=name&workflowId=...`.

The link has `data-testid="advanced-search-link"`.

---

## Dedicated Search Page

### Route

```
/search?q=&field=&scope=&workflowId=&from=&to=
```

Added to `App.tsx` as a top-level route (not nested under `WorkflowLayout`).

### Layout

The page has a minimal header with the app name (linking to `/`) and uses a two-section layout:

1. **Filter bar** (top) — form controls for all search parameters
2. **Results table** (below) — tabular display of search results

### Filter Bar

A horizontal form with the following controls, all updating URL query params on change:

| Control     | Type            | Maps to API param | Default    |
| ----------- | --------------- | ----------------- | ---------- |
| Search term | Text input      | `q`               | (empty)    |
| Field       | Select dropdown | `field`           | All fields |
| Scope       | Select dropdown | `scope`           | `all`      |
| Workflow    | Text input      | `workflowId`      | (empty)    |
| From date   | Date input      | `from`            | (empty)    |
| To date     | Date input      | `to`              | (empty)    |

The **Field** dropdown options are: `All fields`, `Name`, `URI`, `Pin`, `Path`.

The **Scope** dropdown options are: `All`, `Workflows`, `Steps`.

The **Workflow** text input accepts a workflow UUID and is only enabled when scope includes steps. When provided, it adds `workflowId` to the API call.

The **From** and **To** inputs use `<input type="date">` for native browser date pickers. The entered dates are converted to RFC 3339 timestamps (start of day UTC for `from`, end of day UTC for `to`) before being sent to the API.

A "Search" button submits the form. A "Clear" button resets all filters to defaults.

The search is also triggered on Enter from the text input. All filter values are reflected in the URL query string so the page state is shareable and bookmarkable.

Element has `data-testid="search-page"`, form has `data-testid="search-form"`.

### Results Table

Results are displayed in a table with the following columns:

| Column     | Content                                                       |
| ---------- | ------------------------------------------------------------- |
| Type       | Badge: `workflow` or `step`                                   |
| Status     | `StatusBadge` component                                       |
| Name       | Workflow or step name (clickable link)                        |
| Location   | URI for workflows, hierarchy path for steps                   |
| Start Time | Formatted in local timezone via `formatLocalTime`, if present |

Clicking a row navigates to:

- Workflows: `/workflows/:workflowId`
- Steps: `/workflows/:workflowId/steps/:uuid`

The table has `data-testid="search-results-table"`. Empty state shows "No results found." with `data-testid="search-empty"`.

### Data Fetching

Uses TanStack Query with the key `['search', q, field, scope, workflowId, from, to]`. The query is enabled only when `q` is non-empty (at least 1 character). No debounce — the user explicitly submits via button or Enter. `staleTime` is 0 (searches always re-fetch).

---

## Component Tree (Additions)

```
App
├── ... (existing routes)
└── SearchPage                    src/pages/SearchPage.tsx
    ├── SearchForm                src/components/SearchForm.tsx
    └── SearchResultsTable        src/components/SearchResultsTable.tsx
```

Changes to existing components:

```
CommandPalette                    src/components/CommandPalette.tsx
├── (existing input + results)
├── PrefixIndicator (new)         (inline in CommandPalette)
├── SearchHelpPanel (new)         (inline in CommandPalette)
└── footer: + "Advanced Search" link
```

No new shared infrastructure files. The prefix parsing logic is a pure function defined in `CommandPalette.tsx` (not extracted to a separate module unless reused).

---

## Prefix Parsing Function

```typescript
interface ParsedQuery {
  field: "name" | "uri" | "pin" | "path" | null;
  term: string;
}

function parseSearchQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();

  // Quoted query — strip outer quotes, no prefix parsing
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return { field: null, term: trimmed.slice(1, -1) };
  }

  // Check for recognized prefix at start of string
  const prefixes = ["name:", "uri:", "pin:", "path:"] as const;
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) {
      return {
        field: prefix.slice(0, -1) as ParsedQuery["field"],
        term: trimmed.slice(prefix.length).trim(),
      };
    }
  }

  // No prefix
  return { field: null, term: trimmed };
}
```

---

## Source Layout (New Files)

```
ui/src/
  pages/
    SearchPage.tsx              # /search route — filter bar + results table
  components/
    SearchForm.tsx              # Filter controls for advanced search
    SearchResultsTable.tsx      # Tabular results display
```

---

## Updated Route Structure

```
/                                                → UploadPage (landing)
/search?q=&field=&scope=&workflowId=&from=&to=  → SearchPage (advanced search)  [NEW]
/workflows/:workflowId                           → WorkflowView (top-level DAG)
/workflows/:workflowId/steps/:uuid               → StepView (sub-step DAG or leaf detail)
/workflows/:workflowId/logs?stepPath=             → LogsPage (dedicated full-page log viewer)
```

---

## Interaction Flows

### Prefix Search in Command Palette

1. User opens the palette (Ctrl/Cmd+K or search button)
2. User types `name:frontend`
3. The palette parses the prefix, shows the indicator bar: `[Field: name ×] searching for "frontend"`
4. Debounced API call fires with `field=name&q=frontend`
5. Results render below the indicator
6. User can click `×` on the pill to remove the prefix, or edit the input directly

### Quoted Literal Search

1. User types `"name:frontend"` in the palette
2. No prefix indicator is shown (quotes suppress parsing)
3. API call fires with `q=name:frontend` (no `field` param)
4. Results show items where `name:frontend` appears literally in name, URI, or pin

### Help Panel

1. User hovers over `?` — tooltip shows "Search help — supported prefixes and syntax"
2. User clicks `?` — the results area is replaced with the help reference
3. User types in the input — help panel closes, results area returns
4. Alternatively, user clicks `?` again or presses Escape to close

### Command Palette to Advanced Search

1. User has typed `name:build` in the palette
2. User clicks "Advanced Search →" in the footer
3. Palette closes, browser navigates to `/search?q=build&field=name`
4. SearchPage loads with the field dropdown set to "Name" and search term "build"
5. Results table shows matches

### Advanced Search Page

1. User navigates to `/search` (via palette link, direct URL, or landing page)
2. User enters a search term, selects field and scope, optionally sets date range
3. User clicks "Search" or presses Enter
4. URL updates with query params (bookmarkable)
5. Results table renders with type, status, name, location, and start time columns
6. User clicks a row to navigate to the workflow or step

---

## Landing Page Integration

The `UploadPage` gains a link to the advanced search page below or beside the existing `NavigateForm`:

```
Or search for workflows → Advanced Search
```

This provides discoverability for users who arrive at the landing page wanting to find an existing workflow by criteria other than ID.

---

## Frontend E2E Test Plan

New tests are added to `tests/e2e-tests-frontend.ts` following the existing conventions: Playwright via `bun:test`, one `browser.newContext()` per test, `data-testid` selectors, `TEST_TIMEOUT` (30 s), and cleanup via `deleteWorkflow` in `afterAll`. Tests use the existing `nested-hierarchy.json` fixture (which has workflows and steps with known names, URIs, and hierarchy paths).

---

### [24] Command Palette — Prefix Search

Shared setup: upload `nested-hierarchy.json`, navigate to its workflow view.

**[24.1] typing `name:Build` shows prefix indicator with field pill**

1. Open palette (click `[data-testid="search-trigger"]`)
2. Type `name:Build` into `[data-testid="command-palette-input"]`
3. Assert `[data-testid="prefix-indicator"]` is visible
4. Assert the indicator contains the text `name`
5. Wait for `[data-testid="search-result"]` to appear (debounce + API)
6. Assert at least one result is returned (the `name:` prefix scopes the search to the name field)

**[24.2] typing `uri:` prefix shows prefix indicator and returns field-scoped results**

1. Open palette, type `uri:github`
2. Assert `[data-testid="prefix-indicator"]` is visible and contains `uri`
3. Wait for results; assert results are visible or empty state shown (depending on fixture data)

**[24.3] typing `path:/ci` prefix shows prefix indicator and returns path-scoped results**

1. Open palette, type `path:/ci`
2. Assert `[data-testid="prefix-indicator"]` is visible and contains `path`
3. Wait for results; assert at least one result containing `/ci` in its text

**[24.4] typing a plain query (no prefix) does not show prefix indicator**

1. Open palette, type `Build`
2. Assert `[data-testid="prefix-indicator"]` is not present (count === 0)
3. Assert results still appear (existing behavior unchanged)

**[24.5] clicking `×` on the prefix pill removes the prefix from the input**

1. Open palette, type `name:Build`
2. Wait for `[data-testid="prefix-indicator"]` to appear
3. Click the `×` button inside the prefix indicator
4. Assert `[data-testid="prefix-indicator"]` is no longer visible
5. Assert the input value is now `Build` (prefix stripped, search term preserved)

**[24.6] quoted query `"name:Build"` does not show prefix indicator**

1. Open palette, type `"name:Build"`
2. Assert `[data-testid="prefix-indicator"]` is not present
3. Wait for results (API receives literal `name:Build` as `q` with no `field` param)

---

### [25] Command Palette — Help Panel

Shared setup: upload `nested-hierarchy.json`, navigate to its workflow view.

**[25.1] help button is visible in the command palette**

1. Open palette
2. Assert `[data-testid="search-help-button"]` is visible

**[25.2] clicking help button shows the help panel**

1. Open palette
2. Click `[data-testid="search-help-button"]`
3. Assert `[data-testid="search-help-panel"]` is visible
4. Assert the help panel contains text for each prefix (`name:`, `uri:`, `pin:`, `path:`)
5. Assert the help panel mentions quoting / double quotes

**[25.3] clicking help button again closes the help panel**

1. Open palette, click `[data-testid="search-help-button"]` to open
2. Assert `[data-testid="search-help-panel"]` is visible
3. Click `[data-testid="search-help-button"]` again
4. Assert `[data-testid="search-help-panel"]` is not visible

**[25.4] typing in the input closes the help panel and shows results**

1. Open palette, click `[data-testid="search-help-button"]` to open help
2. Assert `[data-testid="search-help-panel"]` is visible
3. Type `Build` into `[data-testid="command-palette-input"]`
4. Assert `[data-testid="search-help-panel"]` is not visible
5. Wait for `[data-testid="search-result"]` to appear

**[25.5] pressing Escape while help panel is open closes the help panel (not the palette)**

1. Open palette, click `[data-testid="search-help-button"]`
2. Assert `[data-testid="search-help-panel"]` is visible
3. Press Escape
4. Assert `[data-testid="search-help-panel"]` is not visible
5. Assert `[data-testid="command-palette"]` is still visible (palette stays open)

---

### [26] Command Palette — Advanced Search Link

Shared setup: upload `nested-hierarchy.json`, navigate to its workflow view.

**[26.1] "Advanced Search" link is visible in the palette footer**

1. Open palette
2. Assert `[data-testid="advanced-search-link"]` is visible

**[26.2] clicking "Advanced Search" with no query navigates to `/search`**

1. Open palette (leave input empty)
2. Click `[data-testid="advanced-search-link"]`
3. Assert palette closes (`[data-testid="command-palette"]` count === 0)
4. Assert URL is `/search`

**[26.3] clicking "Advanced Search" with a prefix query pre-fills URL params**

1. Open palette, type `name:Build`
2. Click `[data-testid="advanced-search-link"]`
3. Assert URL contains `/search`
4. Assert URL search params include `q=Build` and `field=name`

**[26.4] clicking "Advanced Search" from a workflow-scoped palette includes workflowId**

1. Open palette from within a workflow view (palette has `workflowId` context)
2. Type `Build`
3. Click `[data-testid="advanced-search-link"]`
4. Assert URL search params include `q=Build` and `workflowId=<the workflow's ID>`

---

### [27] Advanced Search Page — Rendering & Controls

Shared setup: upload `nested-hierarchy.json`.

**[27.1] `/search` route renders the search page with all form controls**

1. Navigate to `/search`
2. Assert `[data-testid="search-page"]` is visible
3. Assert `[data-testid="search-form"]` is visible
4. Assert form contains: a text input, a field dropdown, a scope dropdown, from date input, to date input, and a submit button

**[27.2] search form submits and displays results in a table**

1. Navigate to `/search`
2. Fill the search text input with `nested-hierarchy`
3. Click the submit button (or press Enter)
4. Wait for `[data-testid="search-results-table"]` to be visible
5. Assert the table contains at least one row
6. Assert the row contains `nested-hierarchy` in its text

**[27.3] selecting a field restricts search results**

1. Navigate to `/search`
2. Set the field dropdown to `Name`
3. Fill the search input with `nested-hierarchy`
4. Submit
5. Wait for results
6. Assert results are visible (the workflow name matches)

**[27.4] search with no results shows empty state**

1. Navigate to `/search`
2. Fill the search input with `zzz-nonexistent-query-zzz`
3. Submit
4. Assert `[data-testid="search-empty"]` is visible

**[27.5] "Clear" button resets all filters**

1. Navigate to `/search`
2. Fill search input, set field to `URI`, set scope to `Workflows`
3. Click the clear button
4. Assert the search input is empty
5. Assert the field dropdown is reset to "All fields"
6. Assert the scope dropdown is reset to "All"
7. Assert from/to date inputs are empty

---

### [28] Advanced Search Page — URL State & Navigation

Shared setup: upload `nested-hierarchy.json`.

**[28.1] submitting a search updates the URL with query params**

1. Navigate to `/search`
2. Fill search input with `Build`, set field to `Name`
3. Submit
4. Assert URL contains `q=Build` and `field=name`

**[28.2] navigating directly to `/search?q=nested-hierarchy` loads with pre-filled form and results**

1. Navigate to `/search?q=nested-hierarchy`
2. Assert the search input contains `nested-hierarchy`
3. Wait for `[data-testid="search-results-table"]` to be visible
4. Assert at least one result is displayed

**[28.3] navigating to `/search?q=Build&field=name&scope=steps` pre-fills all controls**

1. Navigate to `/search?q=Build&field=name&scope=steps`
2. Assert search input contains `Build`
3. Assert field dropdown shows `Name`
4. Assert scope dropdown shows `Steps`

**[28.4] clicking a workflow result navigates to the workflow view**

1. Navigate to `/search?q=nested-hierarchy&scope=workflows`
2. Wait for results
3. Click the first result row
4. Assert URL matches `/workflows/<uuid>`

**[28.5] clicking a step result navigates to the step view**

1. Navigate to `/search?q=Build&scope=steps`
2. Wait for results
3. Click the first result row
4. Assert URL matches `/workflows/<uuid>/steps/<uuid>`

**[28.6] date range filtering sends from/to params to API**

1. Navigate to `/search`
2. Fill search input with `nested-hierarchy`
3. Set the "from" date input to a date before the fixture's upload date
4. Set the "to" date input to today's date
5. Submit
6. Assert results are visible (fixture falls within range)
7. Change the "to" date to a date far in the past (e.g., `2020-01-01`)
8. Submit
9. Assert `[data-testid="search-empty"]` is visible (fixture excluded by range)

---

### [29] Landing Page — Advanced Search Link

**[29.1] landing page has a link to the advanced search page**

1. Navigate to `/` (landing page)
2. Assert a link or button with text matching "Advanced Search" is visible
3. Click it
4. Assert URL is `/search`
5. Assert `[data-testid="search-page"]` is visible
