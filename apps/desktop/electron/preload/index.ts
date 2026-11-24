import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  IPC_CHANNEL_NAMES,
  IPC_EVENT_NAMES,
} from "@cmp/shared-validation/channel-names";

/**
 * The only bridge between the sandboxed renderers and the main process
 * (docs/DOCUMENTATION.md §2.2). Built from the shared channel lists:
 * `"settings:set"` becomes `window.cmp.settings.set(input)` and the push
 * event `"live:state"` becomes `window.cmp.live.onState(listener)`. Each
 * function maps to exactly one channel; `ipcRenderer` itself is never
 * exposed and the renderer cannot choose a channel name. Typed as `CmpApi`
 * (@cmp/shared-validation) on the renderer side.
 */
type Fn = (...args: never[]) => unknown;
const api: Record<string, Record<string, Fn>> = {};

for (const channel of IPC_CHANNEL_NAMES) {
  const [namespace, method] = channel.split(":") as [string, string];
  (api[namespace] ??= {})[method] = ((input?: unknown) =>
    ipcRenderer.invoke(channel, input)) as Fn;
}

for (const event of IPC_EVENT_NAMES) {
  const [namespace, name] = event.split(":") as [string, string];
  const method = `on${name[0]!.toUpperCase()}${name.slice(1)}`;
  (api[namespace] ??= {})[method] = ((listener: (payload: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  }) as Fn;
}

/**
 * Drag-and-drop import (DOCUMENTATION.md §7 step 1): the renderer cannot
 * read files; it asks for a dropped File's path and sends paths to main,
 * which validates every file in the worker.
 */
api["files"] = {
  pathFor: ((file: unknown) => webUtils.getPathForFile(file as never)) as Fn,
};

contextBridge.exposeInMainWorld("cmp", api);

/**
 * Engine ports (DOCUMENTATION.md §2.4): main transfers a MessagePort with
 * `engine:port`. A MessagePort cannot cross contextBridge, so it is handed
 * to the page with window.postMessage (Electron's documented pattern); the
 * page accepts it only from its own window.
 */
const page = globalThis as unknown as {
  postMessage(
    message: unknown,
    targetOrigin: string,
    transfer: unknown[],
  ): void;
};
ipcRenderer.on("engine:port", (event) => {
  // "*" because file:// pages have an opaque origin; the target is always
  // this same window, and the page checks `event.source === window`.
  page.postMessage({ type: "cmp:engine-port" }, "*", event.ports);
});
