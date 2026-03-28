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
