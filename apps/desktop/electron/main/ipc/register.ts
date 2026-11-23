import { app } from "electron";
import { handle } from "./handle";

export function registerIpcHandlers(): void {
  handle("app:info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }));
}
