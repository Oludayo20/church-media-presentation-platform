import type { BrowserWindow } from "electron";
import type { DisplayLike } from "../displays/screen-source";
import type { Logger } from "../logging/logger";
import { createSecureWindow, loadRendererPage } from "../windows/secure-window";
import { EnginePort, type EnginePortHandlers } from "./engine-port";

export interface AudienceOutputOptions {
  display: DisplayLike;
  /** Fake (e2e) displays are windows on the real screen, not fullscreen. */
  simulated: boolean;
  logger: Logger;
  handlers: EnginePortHandlers;
  /** The engine page is loaded and its port connected. */
  onReady(port: EnginePort): void;
}

/**
 * The audience window (DOCUMENTATION.md §4.2): frameless, black, shown only
 * after `ready-to-show` so the projector never flashes white, never takes
 * focus, never throttled in the background, and allowed to autoplay video
 * with sound. macOS uses simple fullscreen to avoid Spaces animations.
 */
export class AudienceOutput {
  readonly window: BrowserWindow;
  readonly port: EnginePort;

  constructor(private readonly options: AudienceOutputOptions) {
    const { display, simulated } = options;
    this.port = new EnginePort("audience", options.handlers);
    this.window = createSecureWindow(
      {
        ...display.bounds,
        title: "Church Media — Audience Output",
        frame: false,
        resizable: simulated,
        movable: simulated,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        enableLargerThanScreen: true,
        autoHideMenuBar: true,
        backgroundColor: "#000000",
      },
      {
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    );

    this.window.once("ready-to-show", () => {
      this.window.showInactive();
      this.goFullscreen();
    });
    this.window.webContents.on("did-finish-load", () => {
      this.port.connect(this.window.webContents);
      options.onReady(this.port);
    });
    this.window.webContents.on("render-process-gone", (_event, details) => {
      options.logger.error(
        `[audience] renderer gone: ${details.reason}; reloading`,
      );
      if (!this.window.isDestroyed()) this.window.reload();
    });
    void loadRendererPage(this.window, "audience");
  }

  /** The display changed size or position: follow it, no reload. */
  moveTo(display: DisplayLike): void {
    if (this.window.isDestroyed()) return;
    this.exitFullscreen();
    this.window.setBounds(display.bounds);
    this.goFullscreen();
  }

  close(): void {
    this.port.close();
    if (!this.window.isDestroyed()) this.window.destroy();
  }

  get closed(): boolean {
    return this.window.isDestroyed();
  }

  private goFullscreen(): void {
    if (this.options.simulated || this.window.isDestroyed()) return;
    if (process.platform === "darwin") this.window.setSimpleFullScreen(true);
    else this.window.setFullScreen(true);
  }

  private exitFullscreen(): void {
    if (this.options.simulated) return;
    if (process.platform === "darwin") this.window.setSimpleFullScreen(false);
    else this.window.setFullScreen(false);
  }
}
