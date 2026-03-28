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
  //   - If the parsed term is empty: clears results immediately and returns
  //   - Otherwise: starts a 400ms timer that calls the search API with the
  //     parsed field, term, current scope (derived from workflowId), and workflowId
  //   - On API success: sets results and resets selectedIndex to 0
  //   - On API failure: clears results
  //   - Sets loading true/false around the API call
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const { field, term } = parseSearchQuery(query);
    if (!term) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const scope = workflowId ? "steps" : "all";
        const resp = await search(term, {
          scope,
          workflowId: workflowId || undefined,
          field: field || undefined,
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

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    if (showHelp) setShowHelp(false);
  }

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

  function handleAdvancedSearch() {
    onClose();
    const params = new URLSearchParams();
    if (parsed.term) params.set("q", parsed.term);
    if (parsed.field) params.set("field", parsed.field);
    if (workflowId) params.set("workflowId", workflowId);
    const qs = params.toString();
    navigate(`/search${qs ? `?${qs}` : ""}`);
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
        {parsed.field && !showHelp && (
          <PalettePrefixIndicator
            field={parsed.field}
            term={parsed.term}
            onDismiss={() => setQuery(parsed.term)}
          />
        )}
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
