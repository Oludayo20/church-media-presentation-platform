/** Returned by the `app:info` IPC channel. */
export interface AppInfo {
  name: string;
  version: string;
  platform: "darwin" | "win32" | "linux" | (string & {});
  electron: string;
  chrome: string;
}
