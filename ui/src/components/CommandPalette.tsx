import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { search, lookupStep, getWorkflow } from "../lib/api";
import type {
  SearchResult,
  StepLookupResponse,
  WorkflowDetail,
  WorkflowSearchResult,
  StepSearchResult,
} from "../lib/types";
import PaletteSearchInput from "./PaletteSearchInput";
import PalettePrefixIndicator from "./PalettePrefixIndicator";
import PaletteHelpPanel from "./PaletteHelpPanel";
import PaletteResultsList from "./PaletteResultsList";
import PaletteFooter from "./PaletteFooter";

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, searches steps within this workflow; otherwise searches workflows only */
  workflowId?: string;
}

interface ParsedQuery {
  q: string | null;
  name: string | null;
  uri: string | null;
  pin: string | null;
  path: string | null;
  id: string | null; // lookup prefix — not a search filter
  invalidPrefixes: string[];
}

type ValidPrefixKey = "name" | "uri" | "pin" | "path" | "id";
const VALID_PREFIXES = new Set<ValidPrefixKey>([
  "name",
  "uri",
  "pin",
  "path",
  "id",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stepLookupToResult(resp: StepLookupResponse): StepSearchResult {
  return {
    type: "step",
    workflowId: resp.workflowId,
    workflowName: "",
    uuid: resp.step.uuid,
    name: resp.step.name,
    uri: resp.step.uri ?? null,
    pin: resp.step.pin ?? null,
    status: resp.step.status,
    hierarchyPath: resp.step.hierarchyPath,
    startTime: resp.step.startTime ?? null,
  };
}

function workflowToResult(w: WorkflowDetail): WorkflowSearchResult {
  return {
    type: "workflow",
    workflowId: w.id,
    name: w.name,
    uri: w.uri ?? null,
    pin: w.pin ?? null,
    status: w.status,
    startTime: w.startTime ?? null,
    uploadedAt: w.uploadedAt,
  };
}
// \S* (not \S+) in the unquoted-value alternative allows "name:" (colon with no
// following characters) to match with an empty-string value, so the prefix pill
// appears as soon as the user types the colon rather than waiting for the first
// value character.
const TOKEN_RE = /(\w+):"([^"]*)"?|(\w+):(\S*)|"([^"]*)"|(\S+)/g;

/**
 * Parses a raw search string into structured per-field parameters.
 *
 * Input format (any combination):
 *   - `prefix:value` or `prefix:"value with spaces"` — assigns value to a
 *     recognised prefix field (name/uri/pin/path).
 *   - Unrecognised `word:value` — the prefix name is added to `invalidPrefixes`
 *     and the full token is treated as a bare term (passed through as-is).
 *   - `"quoted phrase"` — treated as a single bare term (quotes stripped).
 *   - Bare words — concatenated into the general-purpose `q` term.
 *   - Entire input wrapped in double quotes (e.g. `"name:foo"`) — bypasses all
 *     prefix parsing; the literal inner text is returned as `q` only.
 *
 * Returns a `ParsedQuery` where each recognised prefix field holds its parsed
 * value (or null if absent), `q` holds all bare/unrecognised text joined by
 * spaces (or null if none), and `invalidPrefixes` lists any unrecognised prefix
 * words found.
 */
function parseSearchQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();

  // Quoted entire input — strip outer quotes, no prefix parsing
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return {
      q: trimmed.slice(1, -1),
      name: null,
      uri: null,
      pin: null,
      path: null,
      id: null,
      invalidPrefixes: [],
    };
  }

  const result: ParsedQuery = {
    q: null,
    name: null,
    uri: null,
    pin: null,
    path: null,
    id: null,
    invalidPrefixes: [],
  };
  const bareTerms: string[] = [];

  for (const m of trimmed.matchAll(TOKEN_RE)) {
    const [, prefix1, quotedVal, prefix2, unquotedVal, bareQuoted, bareWord] =
      m;

    if (prefix1 !== undefined) {
      if (VALID_PREFIXES.has(prefix1 as ValidPrefixKey)) {
        result[prefix1 as ValidPrefixKey] = quotedVal ?? null;
      } else {
        if (!result.invalidPrefixes.includes(prefix1))
          result.invalidPrefixes.push(prefix1);
        bareTerms.push(`${prefix1}:"${quotedVal}"`);
      }
    } else if (prefix2 !== undefined) {
      if (VALID_PREFIXES.has(prefix2 as ValidPrefixKey)) {
        result[prefix2 as ValidPrefixKey] = unquotedVal ?? null;
      } else {
        if (!result.invalidPrefixes.includes(prefix2))
          result.invalidPrefixes.push(prefix2);
        bareTerms.push(`${prefix2}:${unquotedVal}`);
      }
    } else if (bareQuoted !== undefined) {
      bareTerms.push(bareQuoted);
    } else if (bareWord !== undefined) {
      bareTerms.push(bareWord);
    }
  }

  result.q = bareTerms.length > 0 ? bareTerms.join(" ") : null;

  return result;
}

function queryIsIdLookup(pq: ParsedQuery): boolean {
  return (
    pq.id !== null &&
    pq.q === null &&
    pq.name === null &&
    pq.uri === null &&
    pq.pin === null &&
    pq.path === null
  );
}

/**
 * Serializes a single parsed prefix field back to its query-token form so
 * the round-trip through parseSearchQuery is lossless.
 * Empty values (e.g. from "name:" with no value yet) are kept as "field:".
 * Values containing spaces are quoted; plain values are left bare.
 */
function serializePrefixToken(field: string, value: string): string {
  if (value === "") return `${field}:`;
  if (value.includes(" ")) return `${field}:"${value}"`;
  return `${field}:${value}`;
}

/**
 * Rebuilds the raw query string after the user removes a prefix pill.
 * Remaining prefix fields are re-serialized in canonical order (id, name, uri,
 * pin, path); bare terms (parsed.q) are appended last.
 */
function rebuildQueryWithoutField(
  parsed: ParsedQuery,
  removedField: string,
): string {
  const parts: string[] = [];
  for (const field of ["id", "name", "uri", "pin", "path"] as const) {
    if (parsed[field] !== null && field !== removedField) {
      parts.push(serializePrefixToken(field, parsed[field]!));
    }
  }
  if (parsed.q) parts.push(parsed.q);
  return parts.join(" ");
}

/**
 * When id: appears alongside other terms (not a pure id-only lookup), it
 * cannot be resolved as a UUID, so it is folded into the general-purpose q
 * term and sent to the text-search API as a keyword instead.
 */
function computeEffectiveQ(q: string | null, id: string | null): string | null {
  if (id === null) return q;
  const idTerm = `id:${id}`;
  return q ? `${q} ${idTerm}` : idTerm;
}

/**
 * The prefix indicator bar is visible whenever the user has at least one
 * active field filter or an unrecognised prefix in their query.
 * It is suppressed while the help panel is open — the two panels compete for
 * the same space and the help text takes priority.
 */
function shouldShowPrefixIndicator(
  parsed: ParsedQuery,
  showHelp: boolean,
): boolean {
  return (
    !showHelp &&
    (parsed.id !== null ||
      parsed.name !== null ||
      parsed.uri !== null ||
      parsed.pin !== null ||
      parsed.path !== null ||
      parsed.invalidPrefixes.length > 0)
  );
}

/**
 * Builds the list of valid (colored) filter pills for PalettePrefixIndicator.
 * id: appears as a valid indigo pill only when it is the sole prefix
 * (isIdLookup === true). When combined with other terms it is treated as
 * invalid and appears in buildInvalidPrefixes instead.
 */
function buildPrefixFilters(
  parsed: ParsedQuery,
  isIdLookup: boolean,
): { field: string; value: string }[] {
  return [
    ...(isIdLookup && parsed.id !== null
      ? [{ field: "id", value: parsed.id }]
      : []),
    ...(parsed.name !== null ? [{ field: "name", value: parsed.name }] : []),
    ...(parsed.uri !== null ? [{ field: "uri", value: parsed.uri }] : []),
    ...(parsed.pin !== null ? [{ field: "pin", value: parsed.pin }] : []),
    ...(parsed.path !== null ? [{ field: "path", value: parsed.path }] : []),
  ];
}

/**
 * Builds the list of invalid (red pill) prefix names shown in
 * PalettePrefixIndicator. Combines explicitly unrecognised prefixes with id:
 * when it appears alongside other terms (making a UUID lookup impossible).
 */
function buildInvalidPrefixes(
  parsed: ParsedQuery,
  isIdLookup: boolean,
): string[] {
  return [
    ...parsed.invalidPrefixes,
    ...(!isIdLookup && parsed.id !== null ? ["id"] : []),
  ];
}

/**
 * Constructs the URLSearchParams for the advanced search page, forwarding
 * every active per-field filter from the palette and the current workflow
 * scope. Used by handleAdvancedSearch to pre-populate the search page with
 * the same filters already applied in the palette.
 */
function buildAdvancedSearchParams(
  parsed: ParsedQuery,
  workflowId?: string,
): URLSearchParams {
  const params = new URLSearchParams();
  if (parsed.q) params.set("q", parsed.q);
  if (parsed.name) params.set("name", parsed.name);
  if (parsed.uri) params.set("uri", parsed.uri);
  if (parsed.pin) params.set("pin", parsed.pin);
  if (parsed.path) params.set("path", parsed.path);
  if (workflowId) params.set("workflowId", workflowId);
  return params;
}

/** Returns the appropriate placeholder for the search input based on scope. */
function getPalettePlaceholder(workflowId?: string): string {
  return workflowId ? "Search steps or go to ID..." : "Search or go to ID...";
}

/** Subset of state setters passed to async API helpers so they can update
 *  palette state (results, loading, etc.) without being defined inside the
 *  component closure. */
interface PaletteStateActions {
  setResults: (results: SearchResult[]) => void;
  setSelectedIndex: (index: number) => void;
  setLoading: (loading: boolean) => void;
  setIdLookupMessage: (msg: string | null) => void;
}

/**
 * Executes the debounced text search against the API and updates palette
 * results state. Called inside the 400 ms setTimeout in Effect 2.
 * Clears results on any API failure so the palette never shows stale data.
 */
async function performSearch(
  effectiveQ: string | null,
  name: string | null,
  uri: string | null,
  pin: string | null,
  path: string | null,
  workflowId: string | undefined,
  actions: Pick<
    PaletteStateActions,
    "setResults" | "setSelectedIndex" | "setLoading"
  >,
): Promise<void> {
  actions.setLoading(true);
  try {
    const resp = await search(effectiveQ, {
      workflowId: workflowId || undefined,
      name: name || undefined,
      uri: uri || undefined,
      pin: pin || undefined,
      path: path || undefined,
    });
    actions.setResults(resp.results);
    actions.setSelectedIndex(0);
  } catch {
    actions.setResults([]);
  } finally {
    actions.setLoading(false);
  }
}

/**
 * Resolves a UUID to a step or workflow and updates palette results state.
 * Called by Effect 3 after UUID format validation passes.
 * Tries lookupStep first; falls back to getWorkflow on 404. Shows a
 * "not found" message if both lookups fail.
 */
async function performIdLookup(
  uuid: string,
  actions: PaletteStateActions,
): Promise<void> {
  actions.setLoading(true);
  try {
    try {
      const resp = await lookupStep(uuid);
      actions.setResults([stepLookupToResult(resp)]);
      actions.setIdLookupMessage(null);
      actions.setSelectedIndex(0);
    } catch {
      try {
        const w = await getWorkflow(uuid);
        actions.setResults([workflowToResult(w)]);
        actions.setIdLookupMessage(null);
        actions.setSelectedIndex(0);
      } catch {
        actions.setResults([]);
        actions.setIdLookupMessage("No workflow or step found for this ID");
      }
    }
  } finally {
    actions.setLoading(false);
  }
}

export default function CommandPalette({ open, onClose, workflowId }: Props) {
  // Raw text in the search input. Drives prefix parsing and the debounced API
  // call. Reset to "" when the palette opens.
  const [query, setQuery] = useState("");

  // Current list of search results from the API. Cleared when the palette
  // opens or when the query becomes empty.
  const [results, setResults] = useState<SearchResult[]>([]);

  // Index of the keyboard-highlighted result. Reset to 0 on new results or
  // when the palette opens. Updated by ArrowUp/ArrowDown keys and mouse hover.
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Whether an API request is in flight. Shown as a … indicator next to the input.
  const [loading, setLoading] = useState(false);

  // Message shown in the results area when an id: lookup returns no match or
  // the value is not a valid UUID. Null when no special message is needed.
  const [idLookupMessage, setIdLookupMessage] = useState<string | null>(null);

  // Whether the help panel is displayed instead of the results list. Toggled
  // by the ? button. Cleared when the palette opens or the user types.
  const [showHelp, setShowHelp] = useState(false);

  // Used to programmatically focus the input 50ms after the palette opens
  // (delay allows the DOM to mount before calling .focus()).
  const inputRef = useRef<HTMLInputElement>(null);

  // Holds the current debounce timer ID so the previous timer can be cleared
  // when the query changes before 400ms elapses. Prevents stale API responses
  // from overwriting fresher ones.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A ref mirror of the showHelp state. Needed because the global keydown
  // Escape listener (registered in the open-effect) captures showHelp at
  // registration time via closure. The ref lets the listener read the current
  // value of showHelp without requiring the effect to re-register on every
  // showHelp change (which would tear down and re-add the listener on each toggle).
  const showHelpRef = useRef(false);

  const navigate = useNavigate();

  showHelpRef.current = showHelp;

  const parsed = parseSearchQuery(query);

  // True only when id: is the sole element in the query (no other prefixes or
  // bare terms). In this mode the palette performs a direct UUID lookup instead
  // of a text search, and the debounced search effect is skipped.
  const isIdLookup = queryIsIdLookup(parsed);

  // Bundled state setters passed to async API helpers (performSearch /
  // performIdLookup) so they can update palette state after awaiting.
  const paletteActions: PaletteStateActions = {
    setResults,
    setSelectedIndex,
    setLoading,
    setIdLookupMessage,
  };

  // Effect 1: Open/reset + global Escape handler (deps: [open, onClose])
  //
  // When open transitions to true:
  //   - Resets query, results, selectedIndex, and showHelp to initial values
  //   - Focuses the input after a 50ms delay
  //   - Registers a global keydown listener for Escape:
  //       - If showHelpRef.current is true: closes only the help panel
  //       - Otherwise: calls onClose() to close the entire palette
  //   - Returns a cleanup that removes the listener
  //
  // When open is false: does nothing (no listener registered).
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setShowHelp(false);
      setIdLookupMessage(null);
      setTimeout(() => inputRef.current?.focus(), 50);

      function onEsc(e: KeyboardEvent) {
        if (e.key === "Escape") {
          if (showHelpRef.current) {
            setShowHelp(false);
          } else {
            onClose();
          }
        }
      }
      window.addEventListener("keydown", onEsc);
      return () => window.removeEventListener("keydown", onEsc);
    }
  }, [open, onClose]);

  // Effect 2: Debounced search (deps: [query, open, workflowId])
  //
  // When open is true and query changes:
  //   - Clears any pending debounce timer
  //   - If isIdLookup: skips entirely (Effect 3 handles id: queries)
  //   - If no parsed terms: clears results immediately and returns
  //   - Otherwise: starts a 400ms timer that calls performSearch with all
  //     parsed per-field params and the current workflow scope
  //   - When id: is combined with other terms, computeEffectiveQ folds it into q
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const { q, name, uri, pin, path, id } = parseSearchQuery(query);
    const isIdOnly = queryIsIdLookup({
      q,
      name,
      uri,
      pin,
      path,
      id,
      invalidPrefixes: [],
    });
    if (isIdOnly) return; // handled by Effect 3

    const effectiveQ = computeEffectiveQ(q, id);
    if (!effectiveQ && !name && !uri && !pin && !path) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(
      () =>
        performSearch(
          effectiveQ,
          name,
          uri,
          pin,
          path,
          workflowId,
          paletteActions,
        ),
      400,
    );
  }, [query, open, workflowId]);

  // Effect 3: ID lookup (deps: [isIdLookup, parsed.id, open])
  //
  // Active only when isIdLookup is true (id: is the sole element in the query).
  //   - Validates the value as a UUID; shows "Invalid UUID format" if not.
  //   - Delegates to performIdLookup, which tries lookupStep then getWorkflow.
  //   - If both fail, performIdLookup sets "No workflow or step found for this ID".
  //   - The result is displayed in the standard results list — no special rendering.
  useEffect(() => {
    if (!open || !isIdLookup || parsed.id === null) {
      if (!isIdLookup) setIdLookupMessage(null);
      return;
    }

    const uuid = parsed.id;
    if (!UUID_RE.test(uuid)) {
      setResults([]);
      setIdLookupMessage("Invalid UUID format");
      return;
    }

    setIdLookupMessage(null);
    performIdLookup(uuid, paletteActions);
  }, [isIdLookup, parsed.id, open]);

  // Closes the palette and navigates to the selected result. Workflow results
  // go to the workflow root; step results go to the step's sub-step view.
  // Wrapped in useCallback so the stable reference can be passed to
  // PaletteResultsList without triggering unnecessary re-renders.
  const navigateToResult = useCallback(
    (result: SearchResult) => {
      onClose();
      if (result.type === "workflow") {
        navigate(`/workflows/${result.workflowId}`);
      } else {
        navigate(`/workflows/${result.workflowId}/steps/${result.uuid}`);
      }
    },
    [navigate, onClose],
  );

  // Called on every keystroke in the search input. Syncs raw query state and
  // dismisses the help panel if it was open so the user immediately sees
  // results as they type.
  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    if (showHelp) setShowHelp(false);
  }

  // Keyboard handler attached to the search input. Handles:
  //   Escape    — closes help panel first (if open), otherwise closes palette.
  //   ArrowDown — moves selection down one row, clamped at the last result.
  //   ArrowUp   — moves selection up one row, clamped at 0.
  //   Enter     — navigates to the currently highlighted result (if any).
  // Arrow keys call preventDefault to stop the browser from scrolling the page.
  // Escape calls stopPropagation when help is open to prevent the global window
  // listener from also firing and closing the palette instead of just the panel.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (showHelp) {
        e.stopPropagation();
        setShowHelp(false);
      } else {
        onClose();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      navigateToResult(results[selectedIndex]);
    }
  }

  // Called when the user clicks "Advanced Search →" in the palette footer.
  // Closes the palette and navigates to /search, pre-populating every active
  // per-field param and the workflowId scope via buildAdvancedSearchParams.
  function handleAdvancedSearch() {
    onClose();
    const params = buildAdvancedSearchParams(parsed, workflowId);
    const qs = params.toString();
    navigate(`/search${qs ? `?${qs}` : ""}`);
  }

  // Called when the user clicks × on a prefix pill in PalettePrefixIndicator.
  // Delegates to rebuildQueryWithoutField to re-serialize the remaining fields.
  function handleRemovePrefix(field: string) {
    setQuery(rebuildQueryWithoutField(parsed, field));
  }

  if (!open) return null;

  return (
    <div
      data-testid="command-palette-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
      }}
    >
      <div
        data-testid="command-palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 8,
          width: 540,
          maxWidth: "90vw",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* Always visible: the search input row with the loading indicator and
            the "?" help-toggle button. */}
        <PaletteSearchInput
          ref={inputRef}
          query={query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          loading={loading}
          showHelp={showHelp}
          onToggleHelp={() => setShowHelp((v) => !v)}
          placeholder={getPalettePlaceholder(workflowId)}
        />
        {/* Prefix indicator bar: shown when active filters or invalid prefixes
            exist, but suppressed while the help panel is open. */}
        {shouldShowPrefixIndicator(parsed, showHelp) && (
          <PalettePrefixIndicator
            filters={buildPrefixFilters(parsed, isIdLookup)}
            invalidPrefixes={buildInvalidPrefixes(parsed, isIdLookup)}
            onRemove={handleRemovePrefix}
          />
        )}
        {/* The main body area is either the help panel or the results list —
            never both at once. The help panel takes over the entire body when
            the user toggles it; the results list is shown otherwise. */}
        {showHelp ? (
          <PaletteHelpPanel />
        ) : (
          <PaletteResultsList
            results={results}
            query={query}
            loading={loading}
            selectedIndex={selectedIndex}
            onSelect={navigateToResult}
            onHover={setSelectedIndex}
            workflowId={workflowId}
            emptyMessage={idLookupMessage ?? undefined}
          />
        )}
        <PaletteFooter onAdvancedSearch={handleAdvancedSearch} />
      </div>
    </div>
  );
}
