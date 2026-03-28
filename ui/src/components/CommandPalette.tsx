import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { search } from "../lib/api";
import type { SearchResult } from "../lib/types";
import PaletteSearchInput from "./PaletteSearchInput";
import PalettePrefixIndicator from "./PalettePrefixIndicator";
import PaletteHelpPanel from "./PaletteHelpPanel";
import PaletteResultsList from "./PaletteResultsList";
import PaletteFooter from "./PaletteFooter";

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, default scope is "steps" within this workflow */
  workflowId?: string;
}

interface ParsedQuery {
  q: string | null;
  name: string | null;
  uri: string | null;
  pin: string | null;
  path: string | null;
  invalidPrefixes: string[];
}

type ValidPrefixKey = "name" | "uri" | "pin" | "path";
const VALID_PREFIXES = new Set<ValidPrefixKey>(["name", "uri", "pin", "path"]);
const TOKEN_RE = /(\w+):"([^"]*)"?|(\w+):(\S+)|"([^"]*)"|(\S+)/g;

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
      invalidPrefixes: [],
    };
  }

  const result: ParsedQuery = {
    q: null,
    name: null,
    uri: null,
    pin: null,
    path: null,
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
  //   - If no parsed terms: clears results immediately and returns
  //   - Otherwise: starts a 400ms timer that calls the search API with all
  //     parsed per-field params, current scope (derived from workflowId), and workflowId
  //   - On API success: sets results and resets selectedIndex to 0
  //   - On API failure: clears results
  //   - Sets loading true/false around the API call
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const { q, name, uri, pin, path } = parseSearchQuery(query);
    if (!q && !name && !uri && !pin && !path) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const scope = workflowId ? "steps" : "all";
        const resp = await search(q, {
          scope,
          workflowId: workflowId || undefined,
          name: name || undefined,
          uri: uri || undefined,
          pin: pin || undefined,
          path: path || undefined,
        });
        setResults(resp.results);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, [query, open, workflowId]);

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
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (showHelp) {
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
  // per-field param (q, name, uri, pin, path) and the workflowId scope so the
  // advanced search page starts with the same filters already applied.
  function handleAdvancedSearch() {
    onClose();
    const params = new URLSearchParams();
    if (parsed.q) params.set("q", parsed.q);
    if (parsed.name) params.set("name", parsed.name);
    if (parsed.uri) params.set("uri", parsed.uri);
    if (parsed.pin) params.set("pin", parsed.pin);
    if (parsed.path) params.set("path", parsed.path);
    if (workflowId) params.set("workflowId", workflowId);
    const qs = params.toString();
    navigate(`/search${qs ? `?${qs}` : ""}`);
  }

  // Called when the user clicks × on a prefix pill in PalettePrefixIndicator.
  // Rebuilds the raw query string from the remaining parsed fields, omitting
  // the removed field. Values that contain spaces are re-quoted so the
  // regenerated string round-trips through parseSearchQuery correctly.
  // General bare terms (parsed.q) are appended last without quotes.
  function handleRemovePrefix(field: string) {
    const parts: string[] = [];
    if (parsed.name && field !== "name")
      parts.push(
        parsed.name.includes(" ")
          ? `name:"${parsed.name}"`
          : `name:${parsed.name}`,
      );
    if (parsed.uri && field !== "uri")
      parts.push(
        parsed.uri.includes(" ") ? `uri:"${parsed.uri}"` : `uri:${parsed.uri}`,
      );
    if (parsed.pin && field !== "pin")
      parts.push(
        parsed.pin.includes(" ") ? `pin:"${parsed.pin}"` : `pin:${parsed.pin}`,
      );
    if (parsed.path && field !== "path")
      parts.push(
        parsed.path.includes(" ")
          ? `path:"${parsed.path}"`
          : `path:${parsed.path}`,
      );
    if (parsed.q) parts.push(parsed.q);
    setQuery(parts.join(" "));
  }

  if (!open) return null;

  const placeholder = workflowId
    ? "Search steps..."
    : "Search workflows and steps...";

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
          placeholder={placeholder}
        />
        {/* Show the prefix indicator bar only when the user has at least one
            active field filter or an unrecognised prefix in their query, AND
            the help panel is not currently open (the two panels would compete
            for the same space and the help text is more important to surface
            while it is visible). */}
        {(parsed.name ||
          parsed.uri ||
          parsed.pin ||
          parsed.path ||
          parsed.invalidPrefixes.length > 0) &&
          !showHelp && (
            <PalettePrefixIndicator
              filters={[
                ...(parsed.name ? [{ field: "name", value: parsed.name }] : []),
                ...(parsed.uri ? [{ field: "uri", value: parsed.uri }] : []),
                ...(parsed.pin ? [{ field: "pin", value: parsed.pin }] : []),
                ...(parsed.path ? [{ field: "path", value: parsed.path }] : []),
              ]}
              invalidPrefixes={parsed.invalidPrefixes}
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
          />
        )}
        <PaletteFooter onAdvancedSearch={handleAdvancedSearch} />
      </div>
    </div>
  );
}
