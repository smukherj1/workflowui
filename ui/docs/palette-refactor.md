# Technical Proposal: CommandPalette Refactor

## Problem Statement

The `CommandPalette` component and its integration across the app have two categories of issues:

1. **Duplicated host-site boilerplate.** Three files (`UploadPage`, `LogsPage`, `WorkflowHeader`) each duplicate identical code: a `useState` for open/close, an identical `useEffect` registering a `window` `keydown` listener for Ctrl/Cmd+K, and identical `onClose` callbacks. Any change to this pattern (e.g. adding Meta+K support) requires editing three files.

2. **Monolithic component body.** `CommandPalette.tsx` is a single 517-line function containing the search input bar, prefix indicator, help panel, results list, and footer — all inline. The state variables and refs are undocumented and their interactions are non-obvious.

---

## Proposal

### Part 1: Extract a `useCommandPalette` Hook

Create `src/hooks/useCommandPalette.ts` that encapsulates the open state and Ctrl/Cmd+K keyboard shortcut:

```typescript
// src/hooks/useCommandPalette.ts
import { useState, useEffect, useCallback } from "react";

/**
 * Manages the open/close state of the CommandPalette and registers
 * a global Ctrl/Cmd+K keyboard shortcut to toggle it.
 *
 * Returns:
 * - paletteOpen: whether the palette is currently visible
 * - openPalette: callback to open the palette (for trigger buttons)
 * - closePalette: stable callback to close the palette (passed as onClose)
 */
export function useCommandPalette() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { paletteOpen, openPalette, closePalette } as const;
}
```

**Usage at each site** (replacing ~12 lines with ~1):

```tsx
// Before (repeated in UploadPage, LogsPage, WorkflowHeader):
const [paletteOpen, setPaletteOpen] = useState(false);
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setPaletteOpen((v) => !v);
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);

// After:
const { paletteOpen, openPalette, closePalette } = useCommandPalette();
```

The search trigger button uses `openPalette` instead of `() => setPaletteOpen(true)`, and the `CommandPalette` receives `closePalette` as its `onClose` prop.

**Impact on tests:** None. The hook produces the same `useState` + `useEffect` that each site already has. All `data-testid` selectors, Ctrl+K behavior, and Escape handling remain identical.

---

### Part 2: Break CommandPalette into Sub-Components

Extract the four visual sections of the palette into focused sub-components. All remain in `src/components/` (no new directories):

| New component            | File                         | Responsibility                                             |
| ------------------------ | ---------------------------- | ---------------------------------------------------------- |
| `PaletteSearchInput`     | `PaletteSearchInput.tsx`     | Search icon, `<input>`, loading indicator, help `?` button |
| `PalettePrefixIndicator` | `PalettePrefixIndicator.tsx` | "Field: name" pill with `x` dismiss button                 |
| `PaletteHelpPanel`       | `PaletteHelpPanel.tsx`       | Static help content (prefixes, escaping, tips)             |
| `PaletteResultsList`     | `PaletteResultsList.tsx`     | Results list, empty states, selection highlight            |
| `PaletteFooter`          | `PaletteFooter.tsx`          | Keyboard hints + "Advanced Search" link                    |

`CommandPalette` retains all state and passes it down via props. The sub-components are pure presentational — they receive data and callbacks, hold no state themselves.

**Sketch of the refactored `CommandPalette` render:**

```tsx
export default function CommandPalette({ open, onClose, workflowId }: Props) {
  // ... state, effects, handlers (unchanged) ...

  if (!open) return null;

  return (
    <div
      data-testid="command-palette-overlay"
      onClick={onClose}
      style={overlayStyle}
    >
      <div
        data-testid="command-palette"
        onClick={stopPropagation}
        style={panelStyle}
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
```

**Impact on tests:** None. All `data-testid` attributes stay on the same DOM elements. The sub-components are an internal decomposition — the rendered HTML is identical.

---

### Part 3: Document State Variables, Refs, and Effects

Add comments to each state variable, ref, and effect in `CommandPalette` explaining what it controls and why it exists:

#### State Variables

| Variable        | Type             | Purpose                                                                                                                                                                 |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`         | `string`         | The raw text in the search input. Drives prefix parsing (via `parseSearchQuery`) and the debounced API call. Reset to `""` when the palette opens.                      |
| `results`       | `SearchResult[]` | The current list of search results from the API. Cleared when the palette opens or when the query becomes empty.                                                        |
| `selectedIndex` | `number`         | Index of the keyboard-highlighted result in the results list. Reset to `0` on new results or when the palette opens. Updated by ArrowUp/ArrowDown keys and mouse hover. |
| `loading`       | `boolean`        | Whether an API request is in flight. Shown as a `...` indicator next to the input.                                                                                      |
| `showHelp`      | `boolean`        | Whether the help panel is displayed instead of the results list. Toggled by the `?` button. Cleared when the palette opens or the user types.                           |

#### Refs

| Ref           | Type                                              | Purpose                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputRef`    | `RefObject<HTMLInputElement>`                     | Used to programmatically focus the input 50ms after the palette opens (delay allows the DOM to mount before calling `.focus()`).                                                                                                                                                                                                                                                        |
| `debounceRef` | `MutableRefObject<ReturnType<typeof setTimeout>>` | Holds the current debounce timer ID so the previous timer can be cleared when the query changes before 400ms elapses. Prevents stale API responses from overwriting fresher ones.                                                                                                                                                                                                       |
| `showHelpRef` | `MutableRefObject<boolean>`                       | A ref mirror of the `showHelp` state. Needed because the global `keydown` Escape listener (registered in the open-effect) captures `showHelp` at registration time via closure. The ref lets the listener read the _current_ value of `showHelp` without requiring the effect to re-register on every `showHelp` change (which would tear down and re-add the listener on each toggle). |

#### Effects

**Effect 1: Open/reset + global Escape handler** (`deps: [open, onClose]`)

When `open` transitions to `true`:

- Resets `query`, `results`, `selectedIndex`, and `showHelp` to initial values
- Focuses the input after a 50ms delay
- Registers a global `keydown` listener for Escape:
  - If `showHelpRef.current` is true: closes only the help panel (`setShowHelp(false)`)
  - Otherwise: calls `onClose()` to close the entire palette
- Returns a cleanup that removes the listener

When `open` is `false`: does nothing (no listener registered).

**Effect 2: Debounced search** (`deps: [query, open, workflowId]`)

When `open` is `true` and `query` changes:

- Clears any pending debounce timer
- If the parsed term is empty: clears `results` immediately and returns
- Otherwise: starts a 400ms timer that calls the search API with the parsed `field`, `term`, current `scope` (derived from `workflowId`), and `workflowId`
- On API success: sets `results` and resets `selectedIndex` to `0`
- On API failure: clears `results`
- Sets `loading` true/false around the API call

---

### Part 4: State Simplification Analysis

After reviewing the PRD search user journeys (CUJ 7, 8, 9) and the E2E test suite (test groups [21]-[26]), all five state variables are load-bearing:

| Variable        | Can it be removed? | Reasoning                                                                                                                                                                     |
| --------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`         | No                 | Drives prefix parsing and debounced search. Required by every test that types in the input.                                                                                   |
| `results`       | No                 | Could theoretically move to TanStack Query, but would add complexity without reducing state count — the debounce timer and palette-scoped lifecycle make local state simpler. |
| `selectedIndex` | No                 | Required for arrow-key navigation (tested implicitly via Enter-to-navigate in [21]).                                                                                          |
| `loading`       | No                 | Shown as the `...` indicator. Could be derived from a TanStack Query `isFetching` if search were moved there, but this adds coupling for a single character of UI.            |
| `showHelp`      | No                 | Required for the help panel toggle ([25.1]-[25.5]) and the two-phase Escape behavior ([25.5]).                                                                                |

**Similarly for refs:**

| Ref           | Can it be removed? | Reasoning                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputRef`    | No                 | Required for programmatic focus on open.                                                                                                                                                                                                                                                           |
| `debounceRef` | No                 | Required for debounce cancellation. Could be replaced by an AbortController pattern but that doesn't reduce complexity.                                                                                                                                                                            |
| `showHelpRef` | No                 | Required for the global Escape listener to read current `showHelp` without effect re-registration. Removing it would require adding `showHelp` to the effect's dependency array, causing the listener to be torn down and re-added on every help toggle — a functional but less clean alternative. |

**Conclusion:** No state variables or refs can be removed without breaking tested behavior. The refactoring focus is on **organization and documentation**, not state reduction.

---

## Summary of Changes

| Change                         | Files modified                                         | Files created                    | Tests affected |
| ------------------------------ | ------------------------------------------------------ | -------------------------------- | -------------- |
| `useCommandPalette` hook       | `UploadPage.tsx`, `LogsPage.tsx`, `WorkflowHeader.tsx` | `src/hooks/useCommandPalette.ts` | None           |
| Sub-component extraction       | `CommandPalette.tsx`                                   | 5 new files in `src/components/` | None           |
| State/ref/effect documentation | `CommandPalette.tsx`                                   | None                             | None           |

No E2E tests need to change. All `data-testid` selectors remain on the same rendered elements. The `parseSearchQuery` function stays in `CommandPalette.tsx` (or could be moved to `src/lib/` if desired, but it has no other consumers).

## Execution Order

1. Extract `useCommandPalette` hook and update the three host sites. Run E2E tests.
2. Extract sub-components one at a time (input bar first, then prefix indicator, help panel, results list, footer). Run E2E tests after each extraction.
3. Add documentation comments to state, refs, and effects.

## Verification

Run `bun run test:e2e-frontend`.
