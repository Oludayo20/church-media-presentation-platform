import {
  nativeTheme,
  screen,
  type BrowserWindow,
  type WebContents,
} from "electron";
import type { ConfigStore, SavedWindowState } from "../config/config-store";
import { createSecureWindow, loadRendererPage } from "./secure-window";
import { restoreWindowState } from "./window-state";

const SIZING = { width: 1440, height: 900, minWidth: 1024, minHeight: 640 };
const SAVE_DEBOUNCE_MS = 400;

export async function createOperatorWindow(
  config: ConfigStore,
  hooks: { onLoad?: (contents: WebContents) => void } = {},
): Promise<BrowserWindow> {
  const restored = restoreWindowState(
    config.get().operatorWindow,
    screen.getAllDisplays().map((display) => display.workArea),
    SIZING,
  );

  const window = createSecureWindow({
    ...restored.bounds,
    minWidth: SIZING.minWidth,
    minHeight: SIZING.minHeight,
    title: "Church Media",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0e1116" : "#f7f8fa",
    autoHideMenuBar: true,
  });

  persistWindowState(window, config);
  window.webContents.on("did-finish-load", () =>
    hooks.onLoad?.(window.webContents),
  );
  window.once("ready-to-show", () => {
    if (restored.maximized) window.maximize();
    if (restored.fullScreen) window.setFullScreen(true);
    window.show();
  });
  await loadRendererPage(window, "index");
  return window;
}

/** Saves bounds to config.json on move/resize (debounced) and on close. */
function persistWindowState(window: BrowserWindow, config: ConfigStore): void {
  let timer: NodeJS.Timeout | undefined;

  const save = () => {
    clearTimeout(timer);
    if (window.isDestroyed() || window.isMinimized()) return;
    // Normal bounds, so a maximised window restores to its previous size.
    const bounds = window.getNormalBounds();
    const state: SavedWindowState = {
      ...bounds,
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
    };
    config.update({ operatorWindow: state });
  };
  const saveSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  window.on("resize", saveSoon);
  window.on("move", saveSoon);
  window.on("maximize", save);
  window.on("unmaximize", save);
  window.on("enter-full-screen", save);
  window.on("leave-full-screen", save);
  window.on("close", save);
}
