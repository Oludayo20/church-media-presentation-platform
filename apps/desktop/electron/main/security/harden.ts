import { app, session, shell } from "electron";
import { devServerUrl, rendererDir } from "../paths";
import { isAppUrl } from "./app-url";

/** External links the app may open in the user's browser. */
const EXTERNAL_LINK_HOSTS = new Set<string>([]);

/**
 * App-wide guards applied to every web contents ever created:
 * no new windows, no navigation away from the bundle, no <webview>,
 * and every permission request (camera, mic, notifications…) denied.
 * See docs/SECURITY.md "Electron process isolation".
 */
export function hardenApp(): void {
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternalIfAllowed(url);
      return { action: "deny" };
    });

    const blockForeignNavigation = (
      event: { preventDefault(): void },
      url: string,
    ) => {
      if (!isAppUrl(url, devServerUrl, rendererDir)) event.preventDefault();
    };
    contents.on("will-navigate", blockForeignNavigation);
    contents.on("will-redirect", blockForeignNavigation);
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
  });
}

function openExternalIfAllowed(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && EXTERNAL_LINK_HOSTS.has(parsed.host)) {
      void shell.openExternal(parsed.href);
    }
  } catch {
    // Malformed URL: ignore.
  }
}
