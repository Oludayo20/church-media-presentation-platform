import { useEffect } from "react";
import { create } from "zustand";
import { registerFonts } from "@cmp/presentation-engine";
import { unwrap } from "../../lib/ipc";

interface FontInfo {
  id: string;
  family: string;
  name: string;
}

interface FontsStore {
  fonts: FontInfo[];
  refresh(): Promise<void>;
}

/** Imported, licensed fonts (docs/TASKS.md Phase 7). */
export const useFontsStore = create<FontsStore>()((set) => ({
  fonts: [],
  async refresh() {
    try {
      const fonts = await unwrap(window.cmp.fonts.list());
      set({ fonts });
      // Operator previews and the editor render in this document.
      registerFonts(
        document,
        fonts.map((font) => ({
          family: font.family,
          src: `cmp-media://asset/${font.id}`,
        })),
      );
    } catch {
      // No workspace yet: nothing to register.
    }
  },
}));

/** Keeps imported fonts registered in the operator window. */
export function useImportedFonts(): void {
  const refresh = useFontsStore((state) => state.refresh);
  useEffect(() => {
    void refresh();
    return window.cmp.media.onChanged(() => void refresh());
  }, [refresh]);
}

/** Families offered in text-style pickers: imported first, then common ones. */
export const COMMON_FAMILIES = [
  "Inter, system-ui, sans-serif",
  "Arial, sans-serif",
  "Georgia, serif",
  "Times New Roman, serif",
  "Verdana, sans-serif",
  "Trebuchet MS, sans-serif",
];
