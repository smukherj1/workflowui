# Design: Multi-Prefix Search

## Problem

The command palette and search API only support a single `field` filter at a time. Searching `name:hello` works, but there's no way to search `name:hello pin:foo` (name contains "hello" AND pin contains "foo"). The advanced search page has the same limitation — a single field dropdown.

---

## Query Syntax

The command palette input accepts a structured query language where `prefix:value` tokens restrict search to specific fields. Multiple prefixes can be combined in a single query.

### Grammar

```
query       = token (SPACE token)*
token       = prefixed | bare
prefixed    = PREFIX ":" value
bare        = WORD
value       = QUOTED_STRING | WORD
PREFIX      = "name" | "uri" | "pin" | "path"
QUOTED_STRING = '"' (any char except '"')* '"'
WORD        = (any non-space char)+
```

### Examples

| Input                              | Parsed filters                                  |
| ---------------------------------- | ----------------------------------------------- |
| `hello`                            | `q=hello`                                       |
| `name:hello`                       | `name=hello`                                    |
| `name:hello pin:abc`               | `name=hello`, `pin=abc`                         |
| `name:"hello world" pin:abc`       | `name=hello world`, `pin=abc`                   |
| `name:hello extra`                 | `name=hello`, `q=extra`                         |
| `name:hello uri:github extra`      | `name=hello`, `uri=github`, `q=extra`           |
| `blah:hello`                       | invalid prefix `blah` (highlighted red), treated as `q=blah:hello` |
| `"name:hello"`                     | `q=name:hello` (entire input quoted = literal, no prefix parsing) |

### Rules

1. A token is `prefixed` if it matches `<word>:<value>` where `<word>` is one of the valid prefixes (`name`, `uri`, `pin`, `path`).
2. A quoted value (`"..."`) preserves spaces within the value. The quotes are stripped from the parsed value.
3. Tokens that are not prefixed become general search terms (`q`). If multiple bare tokens exist, they are joined with a space: `foo bar` → `q=foo bar`.
4. If a token has the `prefix:value` shape but the prefix is not one of the four valid prefixes, the prefix text is marked as invalid for UI highlighting. The entire token (including the colon and value) is treated as a bare term added to `q`.
5. Wrapping the **entire input** in double quotes bypasses all prefix parsing (existing behavior preserved). The quotes are stripped and the contents become `q`.
6. All field filters are ANDed together. A result must match every specified filter.

---

## API Changes

### `GET /api/search` — Updated Parameters

| Parameter    | Required | Description                                                                                       |
| ------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `q`          | No*      | General search term — searches name, URI, and pin fields (ILIKE)                                  |
| `name`       | No*      | Search term restricted to the name field (ILIKE)                                                  |
| `uri`        | No*      | Search term restricted to the URI field (ILIKE)                                                   |
| `pin`        | No*      | Search term restricted to the pin field (ILIKE)                                                   |
| `path`       | No*      | Search term restricted to the hierarchy path field (ILIKE, steps only)                            |
| `scope`      | No       | `"workflows"`, `"steps"`, or `"all"` (default `"all"`)                                            |
| `workflowId` | No       | Scope step search to a specific workflow                                                          |
| `from`       | No       | Filter by `startTime >= RFC 3339 timestamp`                                                       |
| `to`         | No       | Filter by `startTime <= RFC 3339 timestamp`                                                       |
| `limit`      | No       | Max results (default 20, max 100)                                                                 |

\* At least one of `q`, `name`, `uri`, `pin`, `path` must be provided. If none are provided, the API returns 400.

The existing `field` parameter is **removed**. The old single-field behavior (`q=hello&field=name`) is replaced by the per-field parameter (`name=hello`).

### Query behavior

All provided search parameters are ANDed:

- `name=hello&pin=abc` → `name ILIKE '%hello%' AND pin ILIKE '%abc%'`
- `q=hello&pin=abc` → `(name ILIKE '%hello%' OR uri ILIKE '%hello%' OR pin ILIKE '%hello%') AND pin ILIKE '%abc%'`
- `name=hello` → `name ILIKE '%hello%'`
- `q=hello` → `name ILIKE '%hello%' OR uri ILIKE '%hello%' OR pin ILIKE '%hello%'` (unchanged from current)

For `scope=workflows`: the `path` parameter is ignored (workflows don't have hierarchy paths). If `path` is the **only** filter and scope is `workflows`, no workflow results are returned.

For `scope=steps`: all parameters apply. `q` searches name, URI, and pin on the step row plus the parent workflow's name.

### Validation (Zod schema)

```typescript
const searchQuerySchema = z.object({
  q: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  uri: z.string().min(1).optional(),
  pin: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  scope: z.enum(["workflows", "steps", "all"]).default("all"),
  workflowId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).refine(
  (d) => d.q || d.name || d.uri || d.pin || d.path,
  { message: "At least one search term (q, name, uri, pin, or path) is required" }
);
```

### Response shape

Unchanged. The response format remains the same as the current `GET /api/search` response.

---

## Database Query Changes

### `searchWorkflows` — Updated

Current: accepts `(q, field?, from?, to?, limit?)` and builds a single ILIKE condition.

Updated: accepts `(filters: { q?, name?, uri?, pin? }, from?, to?, limit?)`. Builds AND-combined conditions:

```sql
SELECT ... FROM workflows
WHERE 1=1
  AND (name ILIKE '%q%' OR uri ILIKE '%q%' OR pin ILIKE '%q%')  -- if q
  AND name ILIKE '%name%'                                         -- if name
  AND uri ILIKE '%uri%'                                           -- if uri
  AND pin ILIKE '%pin%'                                           -- if pin
  AND start_time >= from                                          -- if from
  AND start_time <= to                                            -- if to
ORDER BY uploaded_at DESC
LIMIT limit
```

### `searchSteps` — Updated

Same pattern. Accepts `(filters: { q?, name?, uri?, pin?, path? }, workflowId?, from?, to?, limit?)`. Builds AND-combined conditions:

```sql
SELECT ... FROM steps s JOIN workflows w ON ...
WHERE 1=1
  AND (s.name ILIKE '%q%' OR s.uri ILIKE '%q%' OR s.pin ILIKE '%q%')  -- if q
  AND s.name ILIKE '%name%'                                             -- if name
  AND s.uri ILIKE '%uri%'                                               -- if uri
  AND s.pin ILIKE '%pin%'                                               -- if pin
  AND s.hierarchy_path ILIKE '%path%'                                   -- if path
  AND s.workflow_id = workflowId                                        -- if workflowId
  AND w.start_time >= from                                              -- if from
  AND w.start_time <= to                                                -- if to
ORDER BY w.uploaded_at DESC, s.sort_order
LIMIT limit
```

---

## Frontend: `parseSearchQuery` Rewrite

### Current

Returns `{ field: string | null, term: string }` — a single prefix and the remaining text.

### Updated

Returns a `ParsedQuery` object:

```typescript
interface ParsedQuery {
  q: string | null;               // bare (unprefixed) terms joined with space
  name: string | null;
  uri: string | null;
  pin: string | null;
  path: string | null;
  invalidPrefixes: string[];      // e.g. ["blah"] for "blah:hello"
}
```

The function:

1. If the entire input is wrapped in double quotes, strip quotes and return `{ q: <contents>, name: null, uri: null, pin: null, path: null, invalidPrefixes: [] }`.
2. Tokenize the input, respecting quoted values. A token is either:
   - A `prefix:"quoted value"` or `prefix:word` — matched by regex
   - A bare word
3. For each `prefix:value` token:
   - If `prefix` is valid (`name`, `uri`, `pin`, `path`): set the corresponding field. If the same prefix appears twice, the later value wins.
   - If `prefix` is invalid: add to `invalidPrefixes`, append `prefix:value` to bare terms.
4. Collect bare words into `q` (space-joined, or null if none).

### Tokenizer

Tokenization regex (applied with `matchAll`):

```
/(\w+):"([^"]*)"?|(\w+):(\S+)|"([^"]*)"|(\S+)/g
```

Match groups:
1. `prefix:"quoted value"` → groups 1,2
2. `prefix:unquoted` → groups 3,4
3. `"bare quoted"` → group 5
4. `bare-word` → group 6

---

## Frontend: Command Palette Changes

### Prefix indicator bar

Currently shows a single pill for one prefix. Updated to show **multiple pills**, one per active field filter:

- Each pill shows the field name (e.g., "name", "pin") with its value, colored with distinct colors per field.
- Each pill has a `×` button to remove that specific prefix from the input.
- Clicking `×` on a pill removes the `prefix:value` (or `prefix:"quoted value"`) token from the input text and re-triggers the search.

The indicator bar element keeps `data-testid="prefix-indicator"`. Individual pills within it have `data-testid="prefix-pill"`.

### Invalid prefix highlighting

When `invalidPrefixes` is non-empty, the indicator bar shows a red-colored pill for each invalid prefix with `data-testid="invalid-prefix"`. The pill text is the invalid prefix name with a warning icon or red styling. This gives the user a clear visual hint that the prefix is not recognized.

### Help panel

The help panel text is updated to document multi-prefix syntax, quoted values, and the AND behavior. Example section:

```
Combine multiple filters:
  name:build pin:abc     → name AND pin
  name:"my build" uri:gcs → quoted value with spaces
  build pin:abc          → "build" in any field AND pin
```

### API call

The `search()` function in `api.ts` is updated to accept per-field params instead of a single `field`:

```typescript
interface SearchOptions {
  scope?: string;
  workflowId?: string;
  name?: string;
  uri?: string;
  pin?: string;
  path?: string;
  from?: string;
  to?: string;
  limit?: number;
}

function search(q: string | null, options?: SearchOptions): Promise<SearchResponse>
```

The command palette calls `search()` by spreading the parsed query fields into the options object.

### Advanced Search link handoff

When the user clicks "Advanced Search →" in the palette footer, the URL params forwarded to `/search` are updated to include all active per-field filters:

```
/search?q=extra&name=hello&pin=abc&workflowId=...
```

---

## Frontend: Advanced Search Page Changes

### SearchForm

The single "Field" dropdown and single "Search term" text input are replaced with:

| Control          | Type       | Maps to API param | Notes                                    |
| ---------------- | ---------- | ----------------- | ---------------------------------------- |
| General search   | Text input | `q`               | Searches across name, URI, pin           |
| Name             | Text input | `name`            | Optional, searches name field only       |
| URI              | Text input | `uri`             | Optional, searches URI field only        |
| Pin              | Text input | `pin`             | Optional, searches pin field only        |
| Path             | Text input | `path`            | Optional, searches hierarchy path only   |
| Scope            | Select     | `scope`           | All / Workflows / Steps (unchanged)      |
| Workflow ID      | Text input | `workflowId`      | Unchanged                                |
| From             | Date input | `from`            | Unchanged                                |
| To               | Date input | `to`              | Unchanged                                |

The "Field" dropdown is removed entirely. Each field now has its own labeled text input. At least one of the search inputs (`q`, `name`, `uri`, `pin`, `path`) must be non-empty to submit.

The form reads initial values from URL search params (e.g., `/search?name=hello&pin=abc` pre-fills both inputs). On submit, all non-empty fields are written to URL params. The "Clear" button resets all inputs and calls `onSubmit` with empty values.

Data test IDs:
- `data-testid="search-input-q"` — general search input
- `data-testid="search-input-name"` — name field input
- `data-testid="search-input-uri"` — URI field input
- `data-testid="search-input-pin"` — pin field input
- `data-testid="search-input-path"` — path field input

### SearchPage

TanStack Query key updated: `['search', q, name, uri, pin, path, scope, workflowId, from, to]`. Enabled when at least one search term is non-empty.

URL params updated to include `name`, `uri`, `pin`, `path` alongside existing params. The `field` param is no longer used.

### SearchResultsTable

No changes to the results table rendering — the response shape is unchanged.

---

## Frontend: `src/lib/types.ts`

No type changes needed for the API response. The `SearchResponse` and result types remain the same.

---

## E2E Test Changes

### Backend Tests (`tests/e2e-tests-backend.ts`)

Add new tests within the existing `GET /api/search` describe block:

**Validation:**

```
test: "missing all search terms returns 400"
  GET /api/search?scope=all (no q, no field params)
  → 400

test: "old field param is rejected (400)"
  GET /api/search?q=hello&field=name
  → 400 (field param no longer valid)
```

**Multi-field AND behavior:**

```
test: "name + pin filters are ANDed"
  Upload simple-linear.json (name="simple-linear-pipeline", pin="abc123")
  GET /api/search?name=simple-linear&pin=abc123&scope=workflows
  → 200, results include simple-linear workflow

test: "name + pin AND filters exclude non-matching"
  GET /api/search?name=simple-linear&pin=wrong-pin&scope=workflows
  → 200, results array is empty (pin doesn't match)

test: "q + pin filters are ANDed"
  GET /api/search?q=simple-linear&pin=abc123&scope=workflows
  → 200, results include simple-linear workflow

test: "q + pin AND excludes non-matching"
  GET /api/search?q=simple-linear&pin=wrong-pin&scope=workflows
  → 200, results empty
```

**Per-field params:**

```
test: "name param searches name only"
  GET /api/search?name=simple-linear&scope=workflows
  → 200, finds simple-linear workflow

test: "uri param searches URI only"
  GET /api/search?uri=github&scope=workflows
  → 200, finds workflows with github in URI

test: "pin param searches pin only"
  GET /api/search?pin=abc123&scope=workflows
  → 200, finds workflows with abc123 pin

test: "path param searches hierarchy path (steps)"
  GET /api/search?path=%2Fci%2F&scope=steps
  → 200, finds steps with /ci/ in path

test: "path param ignored for scope=workflows"
  GET /api/search?path=%2Fci&scope=workflows
  → 200, results empty (path not applicable to workflows)
```

**Combined with existing filters:**

```
test: "name + from + to date range"
  GET /api/search?name=simple-linear&from=2020-01-01T00:00:00Z&to=<today>
  → 200, finds workflow
  GET /api/search?name=simple-linear&from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z
  → 200, empty (date range too narrow)

test: "name + workflowId scopes to workflow"
  GET /api/search?name=Build&scope=steps&workflowId=<nestedId>
  → 200, all results have workflowId = nestedId
```

### Frontend Tests (`tests/e2e-tests-frontend.ts`)

**Section [24] — Command Palette: Prefix Search — Updated and expanded:**

```
test [24.1]: updated — "Prefix name:Build shows field indicator with pill"
  Type "name:Build"
  Assert prefix-indicator visible
  Assert exactly 1 prefix-pill visible with text "name"

test [24.2]: updated — "Prefix uri:github shows URI pill"
  Type "uri:github"
  Assert prefix-pill with text "uri"

test [24.3]: updated — "Prefix path:/ci shows path pill"
  Type "path:/ci"
  Assert prefix-pill with text "path"

test [24.4]: unchanged — "Plain query has no indicator"
  (existing test, no changes needed)

test [24.5]: updated — "Clicking × on pill removes that prefix only"
  Type "name:Build pin:abc"
  Assert 2 prefix-pills visible
  Click × on "name" pill
  Assert 1 prefix-pill remains (pin)
  Assert input value is "pin:abc"

test [24.6]: unchanged — "Quoted entire query escapes prefix parsing"
  (existing test, no changes needed)
```

**New tests in section [24]:**

```
test [24.7]: "Multi-prefix name:Build pin:abc shows two pills"
  Open palette, type "name:Build pin:abc"
  Assert prefix-indicator visible
  Assert 2 prefix-pills visible
  Assert pill texts include "name" and "pin"
  Assert search results appear (debounce wait)

test [24.8]: "Multi-prefix with bare term: name:Build extra"
  Open palette, type "name:Build extra"
  Assert 1 prefix-pill (name)
  Assert results appear

test [24.9]: "Invalid prefix shows red indicator"
  Open palette, type "blah:hello"
  Assert invalid-prefix element is visible
  Assert invalid-prefix text contains "blah"

test [24.10]: "Invalid prefix mixed with valid: blah:hello name:Build"
  Open palette, type "blah:hello name:Build"
  Assert 1 prefix-pill (name) is visible
  Assert 1 invalid-prefix (blah) is visible

test [24.11]: "Quoted value with spaces: name:\"hello world\""
  Open palette, type 'name:"hello world"'
  Assert 1 prefix-pill (name) is visible
  Assert results appear (debounce wait)

test [24.12]: "Duplicate prefix: last value wins"
  Open palette, type "name:foo name:bar"
  Assert 1 prefix-pill (name) is visible
  Assert input reflects both tokens but only 1 pill per field
```

**Section [25] — Help Panel — Updated:**

```
test [25.2]: updated — help panel text includes multi-prefix documentation
  Assert panel text contains "Combine" or "multiple" (multi-prefix docs)
  Assert panel text contains example like "name:build pin:abc"
```

**Section [26] — Advanced Search Link — Updated:**

```
test [26.3]: updated — "Click advanced search with multi-prefix query"
  Open palette, type "name:Build pin:abc"
  Wait for prefix pills
  Click advanced search link
  Wait for /search URL
  Assert URL has name=Build param
  Assert URL has pin=abc param
  Assert URL does NOT have field param

test [26.5]: new — "Advanced search with bare + prefix"
  Open palette, type "name:Build extra"
  Click advanced search link
  Assert URL has q=extra param
  Assert URL has name=Build param
```

**Section [27] — Advanced Search Page: Rendering — Updated:**

```
test [27.1]: updated — "Search page renders per-field inputs"
  Navigate to /search
  Assert search-input-q is visible
  Assert search-input-name is visible
  Assert search-input-uri is visible
  Assert search-input-pin is visible
  Assert search-input-path is visible
  Assert no "Field" dropdown exists (removed)
  Assert scope dropdown still exists
  Assert 2 date inputs exist

test [27.2]: updated — "Submit with general search shows results"
  Fill search-input-q with "nested-hierarchy"
  Click submit
  Assert results table visible with at least 1 row

test [27.3]: updated — "Submit with name field shows results"
  Fill search-input-name with "nested-hierarchy"
  Click submit
  Assert results table visible

test [27.6]: new — "Multi-field search (name + pin)"
  Fill search-input-name with "simple-linear"
  Fill search-input-pin with "abc123"
  Click submit
  Assert results table visible with at least 1 row

test [27.7]: new — "Multi-field search with no match"
  Fill search-input-name with "simple-linear"
  Fill search-input-pin with "wrong-pin"
  Click submit
  Assert search-empty visible (no results)

test [27.5]: updated — "Clear button resets all field inputs"
  Fill search-input-q with "test"
  Fill search-input-name with "hello"
  Fill search-input-pin with "abc"
  Select scope dropdown to "workflows"
  Click Clear
  Assert all inputs are empty
```

**Section [28] — URL State & Navigation — Updated:**

```
test [28.1]: updated — "Submit updates URL with per-field params"
  Fill search-input-name with "Build"
  Fill search-input-pin with "abc"
  Click submit
  Assert URL contains name=Build
  Assert URL contains pin=abc
  Assert URL does NOT contain field= param

test [28.2]: updated — "Direct navigation with per-field URL params"
  Navigate to /search?name=nested-hierarchy
  Assert search-input-name value is "nested-hierarchy"
  Assert results table appears

test [28.3]: updated — "Multi-param URL pre-fills all controls"
  Navigate to /search?q=Build&name=hello&scope=steps
  Assert search-input-q value = "Build"
  Assert search-input-name value = "hello"
  Assert scope select value = "steps"

test [28.7]: new — "URL with multiple field params shows results"
  Navigate to /search?name=simple-linear&pin=abc123&scope=workflows
  Assert search-input-name = "simple-linear"
  Assert search-input-pin = "abc123"
  Assert results table visible with at least 1 row
```

---

## Migration & Backward Compatibility

The `field` query parameter is removed from the API. The frontend stops sending it. Since this is an internal API (no external consumers), no deprecation period is needed. The old `?q=hello&field=name` is replaced by `?name=hello`.

---

## Summary of File Changes

| File | Change |
|------|--------|
| `workflow-server/src/routes/search.ts` | Replace `field` param with per-field params (`name`, `uri`, `pin`, `path`); update Zod schema with `.refine()` |
| `workflow-server/src/lib/db.ts` | Update `searchWorkflows` and `searchSteps` to accept filter object and build AND conditions |
| `ui/src/components/CommandPalette.tsx` | Rewrite `parseSearchQuery` for multi-prefix tokenization; render multiple pills; show invalid prefix in red; update API call |
| `ui/src/lib/api.ts` | Update `search()` signature to accept per-field params instead of `field` |
| `ui/src/components/SearchForm.tsx` | Replace field dropdown with per-field text inputs |
| `ui/src/pages/SearchPage.tsx` | Update URL param handling and TanStack Query key for per-field params |
| `ui/design.md` | Update CommandPalette, SearchForm, SearchPage, and API sections |
| `workflow-server/design.md` | Update search API route docs |
| `tests/e2e-tests-backend.ts` | Add multi-field AND tests, per-field param tests, remove `field` param tests |
| `tests/e2e-tests-frontend.ts` | Update prefix tests for multi-pill, add multi-prefix tests, update advanced search tests for per-field inputs |
