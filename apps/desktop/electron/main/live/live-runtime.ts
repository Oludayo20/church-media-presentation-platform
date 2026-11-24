import type { BrowserWindow, WebContents } from "electron";
import type { DisplayStatus, LiveState } from "@cmp/shared-types";
import type { EngineConfig } from "@cmp/shared-validation";
import { createDisplayManager } from "../displays/display-manager";
import type { DisplayLike, ScreenSource } from "../displays/screen-source";
import type { Logger } from "../logging/logger";
import { importMediaFile } from "../media/media-import";
import { createSecureWindow, loadRendererPage } from "../windows/secure-window";
import type { WorkspaceManager } from "../workspace/workspace-manager";
import { AudienceOutput } from "./audience-output";
import { assetUrl, buildDemoPlaylist } from "./demo-playlist";
import { EnginePort } from "./engine-port";
import { LiveSessionController } from "./live-session";

export interface LiveRuntimeOptions {
  screen: ScreenSource;
  /** e2e fake displays: windowed, not fullscreen. */
  simulated: boolean;
  workspaces: WorkspaceManager;
  logger: Logger;
  pushDisplays(status: DisplayStatus): void;
  pushLive(state: LiveState): void;
  chooseMediaFile(): Promise<string | null>;
}

const IDENTIFY_MS = 3000;
export const TEST_DECK_CATEGORY = "test-deck";

/**
 * Wires the pure pieces to Electron: display events open, close and move the
 * audience window; every engine (audience + operator mirror) is a sink of
 * the live session, replayed on (re)connect — which is the hot-plug restore
 * path of DOCUMENTATION.md §4.3.
 */
export function createLiveRuntime(options: LiveRuntimeOptions) {
  const { workspaces, logger } = options;
  let audience: AudienceOutput | null = null;
  let mirrorContents: WebContents | null = null;

  const controller = new LiveSessionController({
    logger,
    onState: options.pushLive,
    displayProfileId: () => displays.profileId,
    journal: () => workspaces.current()?.liveSessions ?? null,
    engineConfig,
    loadPlaylist: async () => {
      const workspace = workspaces.require();
      const church = await workspace.churches.getChurch(workspace.id);
      return buildDemoPlaylist({
        churchName: church?.name ?? "our church",
        logoSrc: church?.logoAssetId ? assetUrl(church.logoAssetId) : null,
        testMedia: await workspace.media.listByCategory(
          workspace.id,
          TEST_DECK_CATEGORY,
        ),
      });
    },
  });

  const mirror = new EnginePort("mirror", {
    onState: (state) => controller.handleEngineState("mirror", state),
    onReplay: () => void controller.replay(mirror),
  });

  const displays = createDisplayManager({
    screen: options.screen,
    logger,
    profiles: () => workspaces.current()?.displayProfiles ?? null,
    outputResolution: async () =>
      (await workspaces
        .current()
        ?.settings.get("display.outputResolution")) ?? { w: 1920, h: 1080 },
    events: {
      changed: options.pushDisplays,
      audienceLost: () => {
        // §4.3: hide the output, keep the session, show the red banner.
        closeAudience();
        if (controller.active && controller.state().output === "display") {
          controller.setOutput("disconnected");
        }
      },
      audienceAvailable: (display) => {
        if (needsAudience()) openAudience(display);
      },
      audienceMoved: (display) => audience?.moveTo(display),
    },
  });

  async function engineConfig(): Promise<EngineConfig> {
    const workspace = workspaces.current();
    const settings = await workspace?.settings.getAll();
    const church = workspace
      ? await workspace.churches.getChurch(workspace.id)
      : null;
    const logoId =
      settings?.["live.logoAssetId"] ?? church?.logoAssetId ?? null;
    return {
      fallbackBackground: settings?.["live.fallbackBackground"] ?? {
        type: "color",
        value: "#000",
      },
      logoSrc: logoId ? assetUrl(logoId) : null,
      logoText: church?.name ?? null,
      safeAreaPct: settings?.["display.safeAreaPct"] ?? 5,
      defaultTransition: settings?.["live.defaultTransition"] ?? {
        type: "fade",
        ms: 300,
      },
      fonts: ((await workspace?.library.licensedFonts()) ?? []).map((font) => ({
        family: font.family,
        src: assetUrl(font.id),
      })),
    };
  }

  function needsAudience(): boolean {
    return controller.active || controller.testPattern;
  }

  function openAudience(display: DisplayLike): void {
    if (audience && !audience.closed) {
      audience.moveTo(display);
      return;
    }
    audience = new AudienceOutput({
      display,
      simulated: options.simulated,
      logger,
      handlers: {
        onState: (state) => controller.handleEngineState("audience", state),
        onReplay: () => audience && void controller.replay(audience.port),
      },
      onReady: (ready) => {
        void controller.addSink(ready, { primary: true }).then(() => {
          if (controller.active) controller.setOutput("display");
        });
      },
    });
    audience.window.on("closed", () => {
      controller.removeSink("audience");
      controller.setPrimarySink(mirror.connected ? "mirror" : null);
    });
  }

  function closeAudience(): void {
    controller.removeSink("audience");
    controller.setPrimarySink(mirror.connected ? "mirror" : null);
    audience?.close();
    audience = null;
  }

  function closeAudienceIfIdle(): void {
    if (!needsAudience()) closeAudience();
  }

  function ensureAudience(): void {
    const display = displays.audienceDisplay();
    if (display) openAudience(display);
  }

  return {
    controller,
    displays,
    /** The engine config the projector uses (logo, fallback, fonts…). */
    engineConfig,

    get audienceWindow(): BrowserWindow | null {
      return audience && !audience.closed ? audience.window : null;
    },

    /** The operator window loaded: give it a mirror engine port. */
    attachOperator(contents: WebContents): void {
      mirrorContents = contents;
      mirror.connect(contents);
      void controller.addSink(mirror, { primary: !audience });
    },

    detachOperator(contents: WebContents): void {
      if (mirrorContents !== contents) return;
      mirror.close();
      controller.removeSink("mirror");
    },

    /** A workspace was opened or created: restore remembered displays. */
    async workspaceReady(): Promise<void> {
      await displays.restore();
    },

    async start(
      startAt?: { itemIndex: number; slideIndex: number },
      service?: Parameters<LiveSessionController["start"]>[0]["service"],
    ): Promise<LiveState> {
      const display = displays.audienceDisplay();
      const state = await controller.start({
        output: display ? "display" : "preview",
        startAt,
        ...(service ? { service } : {}),
      });
      ensureAudience();
      return state;
    },

    async end(): Promise<LiveState> {
      const state = await controller.end();
      closeAudienceIfIdle();
      return state;
    },

    testPattern(on: boolean): LiveState {
      const state = controller.setTestPattern(on);
      if (on) ensureAudience();
      else closeAudienceIfIdle();
      return state;
    },

    continueInPreview(): LiveState {
      if (controller.state().output === "disconnected")
        controller.setOutput("preview");
      return controller.state();
    },

    async addTestMedia(): Promise<LiveState> {
      const workspace = workspaces.require();
      const sourcePath = await options.chooseMediaFile();
      if (sourcePath) {
        await importMediaFile({
          sourcePath,
          mediaDir: workspace.mediaDir,
          churchId: workspace.id,
          category: TEST_DECK_CATEGORY,
          media: workspace.media,
          accept: ["image", "video"],
        });
        logger.info("[live] test media added (used from the next session)");
      }
      return controller.state();
    },

    /** Big numbers on every display so the operator can tell them apart. */
    identify(): void {
      displays.allDisplays().forEach((display, index) => {
        const window = createSecureWindow({
          ...display.workArea,
          frame: false,
          transparent: false,
          backgroundColor: "#000000",
          focusable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          resizable: false,
          hasShadow: false,
        });
        const status = displays
          .status()
          .displays.find((info) => info.id === display.id);
        window.once("ready-to-show", () => window.showInactive());
        void loadRendererPage(window, "audience", {
          identify: String(index + 1),
          label: `${status?.label ?? "Display"} · ${status?.width}×${status?.height}`,
        });
        setTimeout(() => {
          if (!window.isDestroyed()) window.destroy();
        }, IDENTIFY_MS);
      });
    },

    async settingsChanged(): Promise<void> {
      await controller.refreshConfig();
    },

    dispose(): void {
      controller.dispose();
      closeAudience();
    },
  };
}

export type LiveRuntime = ReturnType<typeof createLiveRuntime>;
