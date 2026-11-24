import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

/**
 * Injects the Content-Security-Policy meta tag. Production gets the strict
 * policy from docs/DOCUMENTATION.md §2.1; dev relaxes it only as far as
 * Vite's HMR client and React Refresh preamble require.
 */
function contentSecurityPolicy(): Plugin {
  const production = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: cmp-media:",
    "media-src 'self' cmp-media:",
    "font-src 'self' cmp-media:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const development = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: cmp-media:",
    "media-src 'self' cmp-media:",
    "font-src 'self' cmp-media:",
    "connect-src 'self' ws://localhost:*",
    "object-src 'none'",
  ].join("; ");

  return {
    name: "cmp-content-security-policy",
    transformIndexHtml(html, ctx) {
      const policy = ctx.server ? development : production;
      return html.replace("%CSP%", policy);
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: {
          index: resolve(__dirname, "electron/main/index.ts"),
          // The utilityProcess worker (imports, ffmpeg) — see electron/worker.
          worker: resolve(__dirname, "electron/worker/index.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      rolldownOptions: {
        input: { index: resolve(__dirname, "electron/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src"),
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(__dirname, "src/index.html"),
          audience: resolve(__dirname, "src/audience.html"),
          // Hidden window: PDF rasterising and slide export (never shown).
          render: resolve(__dirname, "src/render.html"),
        },
      },
    },
  },
});
