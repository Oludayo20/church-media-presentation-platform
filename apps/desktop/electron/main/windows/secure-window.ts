import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";
import { devServerUrl, preloadPath, rendererDir } from "../paths";

export type RendererPage = "index" | "audience";

/**
 * Every window in the app is created here so the security settings from
 * docs/DOCUMENTATION.md §2.1 cannot be forgotten or overridden.
 */
export function createSecureWindow(
  options: Omit<BrowserWindowConstructorOptions, "webPreferences">,
): BrowserWindow {
  return new BrowserWindow({
    ...options,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      preload: preloadPath,
    },
  });
}

export function loadRendererPage(
  window: BrowserWindow,
  page: RendererPage,
): Promise<void> {
  if (devServerUrl) {
    return window.loadURL(`${devServerUrl}/${page}.html`);
  }
  return window.loadFile(join(rendererDir, `${page}.html`));
}
