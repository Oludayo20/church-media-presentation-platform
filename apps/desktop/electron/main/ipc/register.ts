import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  type OpenDialogOptions,
} from "electron";
import type { EventPayload, IpcEvent, Settings } from "@cmp/shared-validation";
import { createBibleService } from "../bible/bible-service";
import type { JobRunner } from "../jobs/job-runner";
import type { LiveRuntime } from "../live/live-runtime";
import type { MediaLibrary } from "../media/media-library";
import type { PresentationFiles } from "../presentations/presentation-files";
import { createServiceService } from "../services/service-service";
import type { SongService } from "../songs/song-service";
import type { Logger } from "../logging/logger";
import { devServerUrl, rendererDir } from "../paths";
import { isAppUrl } from "../security/app-url";
import type { WorkspaceManager } from "../workspace/workspace-manager";
import { createIpcHandlers } from "./handlers";
import { registerIpcRouter } from "./router";

export function applyNativeTheme(theme: Settings["ui.theme"]): void {
  nativeTheme.themeSource = theme;
}

/** Native "open file" dialog parented to the focused window. */
export async function chooseFiles(
  options: OpenDialogOptions,
): Promise<string[]> {
  const parent = BrowserWindow.getFocusedWindow();
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

export async function chooseFile(
  options: OpenDialogOptions,
): Promise<string | null> {
  return (await chooseFiles(options))[0] ?? null;
}

/**
 * Main → renderer push (`live:state`, `displays:changed`). Sent only to
 * operator windows (the audience window has no use for them).
 */
export function pushEvent<E extends IpcEvent>(
  event: E,
  payload: EventPayload<E>,
  isOperator: (window: BrowserWindow) => boolean,
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && isOperator(window)) {
      window.webContents.send(event, payload);
    }
  }
}

export function registerIpcHandlers(
  workspaces: WorkspaceManager,
  live: LiveRuntime,
  media: MediaLibrary,
  songs: SongService,
  jobs: JobRunner,
  files: PresentationFiles,
  logger: Logger,
): void {
  const bible = createBibleService({
      workspaces,
      jobs,
      live: live.controller,
      choosePackage: () =>
        chooseFile({
          title: "Install a Bible translation",
          properties: ["openFile"],
          filters: [
            { name: "Bible translation packages", extensions: ["cmpbible"] },
          ],
        }),
  });
  const services = createServiceService({
    workspaces,
    songs,
    live,
    logger,
    engineConfig: () => live.engineConfig(),
    scripture: (translation, reference, onePerSlide) =>
      bible.requirePassage(translation, reference, onePerSlide),
  });
  const handlers = createIpcHandlers({
    workspaces,
    live,
    media,
    songs,
    files,
    bible,
    services,
    appInfo: () => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    }),
    chooseFontFiles: () =>
      chooseFiles({
        title: "Import fonts",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Fonts", extensions: ["ttf", "otf"] }],
      }),
    choosePresentationFile: () =>
      chooseFile({
        title: "Import a presentation",
        properties: ["openFile"],
        filters: [
          { name: "Church Media presentations", extensions: ["cmppres"] },
        ],
      }),
    choosePresentationDestination: async (title) => {
      const options = {
        title: "Export presentation",
        defaultPath: `${title.replace(/[<>:"/\\|?*]/gu, "_")}.cmppres`,
        filters: [
          { name: "Church Media presentations", extensions: ["cmppres"] },
        ],
      };
      const parent = BrowserWindow.getFocusedWindow();
      const result = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options);
      return result.canceled ? null : (result.filePath ?? null);
    },
    chooseImageFile: () =>
      chooseFile({
        title: "Choose your church logo",
        properties: ["openFile"],
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        ],
      }),
    onSettingsChanged: (settings) => applyNativeTheme(settings["ui.theme"]),
  });

  registerIpcRouter(ipcMain, handlers, {
    isTrustedSender: (url) => isAppUrl(url, devServerUrl, rendererDir),
    logger,
  });
}
