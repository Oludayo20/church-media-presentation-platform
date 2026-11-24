import { useEffect } from "react";
import type { Theme } from "@cmp/shared-validation";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/**
 * Applies `ui.theme` to <html data-theme>. Dark is the token default, so
 * only "light" sets the attribute. "system" follows the OS (main mirrors the
 * setting into `nativeTheme.themeSource`, which drives this media query).
 */
export function useApplyTheme(theme: Theme): void {
  useEffect(() => {
    const root = document.documentElement;
    const query = window.matchMedia(LIGHT_QUERY);
    const apply = () => {
      const light = theme === "light" || (theme === "system" && query.matches);
      if (light) root.dataset["theme"] = "light";
      else delete root.dataset["theme"];
    };
    apply();
    if (theme !== "system") return;
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);
}
