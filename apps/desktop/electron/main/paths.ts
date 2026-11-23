import { join } from "node:path";

/** Built renderer bundle (`out/renderer`), relative to `out/main/index.js`. */
export const rendererDir = join(__dirname, "../renderer");
export const preloadPath = join(__dirname, "../preload/index.js");

/** Set by electron-vite while running `electron-vite dev`. */
export const devServerUrl: string | undefined =
  process.env["ELECTRON_RENDERER_URL"];
