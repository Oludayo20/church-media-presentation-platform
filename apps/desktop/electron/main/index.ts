import { join } from "node:path";
import { app, BrowserWindow, dialog, screen, utilityProcess } from "electron";
import { resolveFfTools } from "@cmp/media-processing";
import { parseEngineDocument } from "@cmp/shared-validation";
import { MigrationError, WorkspaceTooNewError } from "@cmp/database";
import { createConfigStore } from "./config/config-store";
import {
  electronScreenSource,
  FakeScreen,
  type ScreenSource,
} from "./displays/screen-source";
import {
  applyNativeTheme,
  chooseFile,
  chooseFiles,
  pushEvent,
  registerIpcHandlers,
} from "./ipc/register";
import { JobRunner } from "./jobs/job-runner";
import { createLiveRuntime } from "./live/live-runtime";
import { createMediaLibrary } from "./media/media-library";
import { createPresentationFiles } from "./presentations/presentation-files";
import { RenderHost } from "./render/render-host";
import { createSongService } from "./songs/song-service";
import { setupLogging } from "./logging/setup";
import {
  registerMediaProtocol,
  registerMediaScheme,
} from "./media/register-protocol";
import { userDataPaths } from "./paths";
import { hardenApp } from "./security/harden";
import { createOperatorWindow } from "./windows/operator-window";
import {
  createWorkspaceManager,
  type WorkspaceManager,
} from "./workspace/workspace-manager";

app.setName("Church Media");
configureUserDataPath();
// Privileged schemes must be registered before the app is ready.
registerMediaScheme();

// One instance only: two copies fighting over the projector is a
// service-stopping failure. The lock is per userData directory.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void main();
}

async function main(): Promise<void> {
  const paths = userDataPaths(app.getPath("userData"));
  const log = setupLogging(paths.logs);
  log.info(
    `[app] starting ${app.getVersion()} (electron ${process.versions.electron}, ${process.platform}/${process.arch})`,
  );

  hardenApp();
  const config = createConfigStore(paths.config, log);
  const workspaces = createWorkspaceManager({
    workspacesDir: paths.workspaces,
    backupsDir: paths.backups,
    appVersion: app.getVersion(),
    config,
    logger: log,
  });

  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", () => workspaces.close());

  await app.whenReady();

  try {
    const workspace = await workspaces.openActive();
    if (workspace) {
      applyNativeTheme(await workspace.settings.get("ui.theme"));
    }
  } catch (error) {
    log.error("[app] could not open the workspace", error);
    showStartupFailure(error, workspaces, paths.logs);
    app.exit(1);
    return;
  }

  const operatorWindows = new Set<BrowserWindow>();
  const isOperator = (window: BrowserWindow) => operatorWindows.has(window);
  const live = createLiveRuntime({
    screen: screenSource(),
    simulated: fakeDisplaysEnabled(),
    workspaces,
    logger: log,
    pushDisplays: (status) => pushEvent("displays:changed", status, isOperator),
    pushLive: (state) => pushEvent("live:state", state, isOperator),
    chooseMediaFile: () =>
      chooseFile({
        title: "Add an image or video to the test deck",
        properties: ["openFile"],
        filters: [
          {
            name: "Images and videos",
            extensions: [
              "png",
              "jpg",
              "jpeg",
              "webp",
              "gif",
              "mp4",
              "m4v",
              "mov",
              "webm",
            ],
          },
        ],
      }),
  });
  app.on("will-quit", () => live.dispose());

  const jobs = new JobRunner(
    () =>
      utilityProcess.fork(join(__dirname, "worker.js"), [], {
        serviceName: "Church Media worker",
        stdio: "inherit",
      }),
    log,
  );
  const tools = resolveFfTools({ bundledDir: ffmpegBundleDir() });
  log.info(
    `[media] ffmpeg: ${tools.ffmpeg ?? "not found"} · ffprobe: ${tools.ffprobe ?? "not found"}`,
  );
  const media = createMediaLibrary({
    workspaces,
    jobs,
    tools: () => tools,
    logger: log,
    pushProgress: (progress) =>
      pushEvent("jobs:progress", progress, isOperator),
    pushChanged: (reason) => pushEvent("media:changed", { reason }, isOperator),
    chooseFiles: () =>
      chooseFiles({
        title: "Import media",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Media",
            extensions: [
              "png",
              "jpg",
              "jpeg",
              "webp",
              "gif",
              "mp4",
              "m4v",
              "mov",
              "webm",
              "mp3",
              "wav",
              "aac",
              "m4a",
              "pdf",
              "pptx",
              "ttf",
              "otf",
            ],
          },
        ],
      }),
  });
  app.on("will-quit", () => jobs.dispose());

  registerMediaProtocol(workspaces, log);
  const songs = createSongService({
    workspaces,
    jobs,
    live: () => live.controller,
    logger: log,
    chooseFiles: () =>
      chooseFiles({
        title: "Import songs",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Songs (text, OpenLyrics, SongSelect)",
            extensions: ["txt", "xml", "usr"],
          },
        ],
      }),
  });
  const renderer = new RenderHost(log);
  app.on("will-quit", () => renderer.dispose());
  const files = createPresentationFiles({
    workspaces,
    jobs,
    media,
    renderer,
    tools: () => tools,
    engineConfig: () => live.engineConfig(),
    isLive: () => live.controller.active,
    logger: log,
    save: async (doc) => {
      const saved = await workspaces.require().presentations.save(null, 0, doc);
      const parsed = parseEngineDocument(saved.snapshot);
      if (!parsed.success) throw new Error(parsed.error);
      return { version: saved.version, doc: parsed.doc };
    },
    chooseImportFile: () =>
      chooseFile({
        title: "Import PowerPoint or PDF",
        properties: ["openFile"],
        filters: [{ name: "PowerPoint or PDF", extensions: ["pptx", "pdf"] }],
      }),
    chooseExportFolder: async () => {
      const parent = BrowserWindow.getFocusedWindow();
      const options = {
        title: "Export slides as PNG images",
        properties: ["openDirectory", "createDirectory"] as (
          "openDirectory" | "createDirectory"
        )[],
      };
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    chooseExportPdf: async (title) => {
      const parent = BrowserWindow.getFocusedWindow();
      const options = {
        title: "Export as PDF",
        defaultPath: `${title}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      };
      const result = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options);
      return result.canceled ? null : (result.filePath ?? null);
    },
  });
  registerIpcHandlers(workspaces, live, media, songs, jobs, files, log);
  if (workspaces.current()) {
    await live.workspaceReady();
    // §7 step 8: verify the media store in the background at start-up.
    void media
      .scanMissing()
      .catch((error: unknown) => log.error("[media] scan failed", error));
  }

  const openOperator = async () => {
    const window = await createOperatorWindow(config, {
      // Every (re)load gets a fresh mirror engine port, replayed by the session.
      onLoad: (contents) => live.attachOperator(contents),
    });
    operatorWindows.add(window);
    window.on("closed", () => operatorWindows.delete(window));
    // Closing the operator window ends the app: never leave the projector
    // showing content nobody can control.
    window.on("closed", () => {
      if (operatorWindows.size === 0) live.dispose();
    });
  };
  await openOperator();

  app.on("activate", () => {
    if (operatorWindows.size === 0) void openOperator();
  });
}

/** Bundled LGPL ffmpeg/ffprobe (docs/HOSTING.md); absent in development. */
function ffmpegBundleDir(): string {
  // electron-builder's ${os} naming: mac | win | linux.
  const os =
    { darwin: "mac", win32: "win" }[process.platform as string] ?? "linux";
  const platformDir = `${os}-${process.arch}`;
  return app.isPackaged
    ? join(process.resourcesPath, "ffmpeg", platformDir)
    : join(app.getAppPath(), "resources", "ffmpeg", platformDir);
}

function fakeDisplaysEnabled(): boolean {
  return !app.isPackaged && process.env["CMP_FAKE_DISPLAYS"] === "1";
}

/**
 * Electron's screen, or — for e2e only — a scriptable fake exposed as
 * `globalThis.__cmpTest.screen` so Playwright can plug and unplug displays.
 */
function screenSource(): ScreenSource {
  if (!fakeDisplaysEnabled()) return electronScreenSource(screen as never);
  const primary = screen.getPrimaryDisplay();
  const fake = new FakeScreen({
    id: primary.id,
    label: primary.label,
    bounds: primary.bounds,
    workArea: primary.workArea,
    scaleFactor: primary.scaleFactor,
    internal: primary.internal,
  });
  (globalThis as { __cmpTest?: unknown }).__cmpTest = { screen: fake };
  return fake;
}

/**
 * Keeps development and e2e data away from a real workspace:
 * `CMP_USER_DATA_DIR` (unpackaged builds only, used by Playwright) or a
 * separate "(dev)" folder when running unpackaged.
 */
function configureUserDataPath(): void {
  if (app.isPackaged) return;
  const override = process.env["CMP_USER_DATA_DIR"];
  app.setPath(
    "userData",
    override ?? join(app.getPath("appData"), "Church Media (dev)"),
  );
}

function showStartupFailure(
  error: unknown,
  workspaces: WorkspaceManager,
  logsDir: string,
): void {
  if (error instanceof WorkspaceTooNewError) {
    dialog.showErrorBox(
      "Update Church Media",
      "This workspace was saved by a newer version of Church Media. Install the latest version to open it. Your data has not been changed.",
    );
    return;
  }
  if (error instanceof MigrationError) {
    const backup = workspaces.lastBackupPath;
    dialog.showErrorBox(
      "Could not upgrade your workspace",
      `Your data is safe: the upgrade was rolled back.${backup ? `\n\nA backup was saved to:\n${backup}` : ""}\n\nPlease contact support and include the log files from:\n${logsDir}`,
    );
    return;
  }
  dialog.showErrorBox(
    "Church Media could not start",
    `Your workspace could not be opened. Please contact support and include the log files from:\n${logsDir}`,
  );
}
