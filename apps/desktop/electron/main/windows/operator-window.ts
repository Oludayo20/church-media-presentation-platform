import type { BrowserWindow } from "electron";
import { createSecureWindow, loadRendererPage } from "./secure-window";

export async function createOperatorWindow(): Promise<BrowserWindow> {
  const window = createSecureWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "Church Media",
    backgroundColor: "#0e1116",
    autoHideMenuBar: true,
  });

  window.once("ready-to-show", () => window.show());
  await loadRendererPage(window, "index");
  return window;
}
