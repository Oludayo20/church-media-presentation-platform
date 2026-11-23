import { pathToFileURL } from "node:url";

/**
 * Decides whether a URL belongs to the app's own renderer bundle.
 * Used to block navigation away from the app and to reject IPC from
 * unexpected frames (docs/SECURITY.md "IPC input validation").
 *
 * @param url        the URL being navigated to / sending IPC
 * @param devServer  `ELECTRON_RENDERER_URL` in dev, undefined in production
 * @param rendererDir absolute path of the built renderer (`out/renderer`)
 */
export function isAppUrl(
  url: string,
  devServer: string | undefined,
  rendererDir: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (devServer) {
    return parsed.origin === new URL(devServer).origin;
  }

  if (parsed.protocol !== "file:") return false;
  const root = pathToFileURL(rendererDir).href.replace(/\/?$/, "/");
  return parsed.href.startsWith(root);
}
