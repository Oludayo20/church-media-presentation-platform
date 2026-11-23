import { contextBridge, ipcRenderer } from "electron";
import type { CmpApi } from "@cmp/shared-types";

/**
 * The only bridge between the sandboxed renderers and the main process.
 * Named functions only — never expose ipcRenderer or a channel parameter.
 * See docs/DOCUMENTATION.md §2.2.
 */
const api: CmpApi = {
  app: {
    info: () => ipcRenderer.invoke("app:info"),
  },
};

contextBridge.exposeInMainWorld("cmp", api);
