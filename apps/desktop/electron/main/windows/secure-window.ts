import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";
import { rendererLog } from "../logging/setup";
import { devServerUrl, preloadPath, rendererDir } from "../paths";

export type RendererPage = "index" | "audience" | "render";

/**
 * Every window in the app is created here so the security settings from
 * docs/DOCUMENTATION.md §2.1 cannot be forgotten or overridden.
 */
/** The only web preferences a caller may adjust; security ones are fixed. */
export interface WindowTuning {
  backgroundThrottling?: boolean;
  autoplayPolicy?: "no-user-gesture-required" | "user-gesture-required";
  /** Offscreen rendering (render window): paints at 1:1 pixels, never shown. */
  offscreen?: boolean;
}

export function createSecureWindow(
  options: Omit<BrowserWindowConstructorOptions, "webPreferences">,
  tuning: WindowTuning = {},
): BrowserWindow {
  const window = new BrowserWindow({
    ...options,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      preload: preloadPath,
      ...tuning,
    },
  });

  // Renderer warnings and errors go to logs/renderer.log.
  window.webContents.on("console-message", (event) => {
    if (event.level === "error" || event.level === "warning") {
      rendererLog[event.level === "error" ? "error" : "warn"](
        `${event.message} (${event.sourceId}:${event.lineNumber})`,
      );
    }
  });
  return window;
}

export function loadRendererPage(
  window: BrowserWindow,
  page: RendererPage,
  query: Record<string, string> = {},
): Promise<void> {
  if (devServerUrl) {
    const search = new URLSearchParams(query).toString();
    return window.loadURL(
      `${devServerUrl}/${page}.html${search ? `?${search}` : ""}`,
    );
  }
  return window.loadFile(join(rendererDir, `${page}.html`), { query });
}
