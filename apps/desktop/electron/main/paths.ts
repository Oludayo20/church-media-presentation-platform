import { join } from "node:path";

/** Built renderer bundle (`out/renderer`), relative to `out/main/index.js`. */
export const rendererDir = join(__dirname, "../renderer");
export const preloadPath = join(__dirname, "../preload/index.js");

/** Set by electron-vite while running `electron-vite dev`. */
export const devServerUrl: string | undefined =
  process.env["ELECTRON_RENDERER_URL"];

/** Filesystem layout under `userData` (docs/DOCUMENTATION.md §13). */
export interface UserDataPaths {
  root: string;
  config: string;
  workspaces: string;
  backups: string;
  downloads: string;
  logs: string;
}

export function userDataPaths(root: string): UserDataPaths {
  return {
    root,
    config: join(root, "config.json"),
    workspaces: join(root, "workspaces"),
    backups: join(root, "backups"),
    downloads: join(root, "downloads"),
    logs: join(root, "logs"),
  };
}
