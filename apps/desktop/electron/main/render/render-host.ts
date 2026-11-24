import {
  MessageChannelMain,
  type BrowserWindow,
  type MessagePortMain,
} from "electron";
import type {
  EngineConfig,
  EngineDocumentInput,
  RenderRequest,
  RenderResponse,
} from "@cmp/shared-validation";
import type { Logger } from "../logging/logger";
import { createSecureWindow, loadRendererPage } from "../windows/secure-window";

/** A request without its id (distributes over the union). */
type Body = RenderRequest extends infer R
  ? R extends RenderRequest
    ? Omit<R, "id">
    : never
  : never;

/**
 * The hidden render window (`render.html`): offscreen, sandboxed, never
 * shown. Requests are serialised (one page layout at a time).
 */
export class RenderHost {
  private window: BrowserWindow | null = null;
  private port: MessagePortMain | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve(r: RenderResponse): void; reject(e: Error): void }
  >();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly logger: Logger) {}

  /** Rasterises a PDF: one PNG per page, fitted inside maxWidth × maxHeight. */
  pdfToImages(
    bytes: ArrayBuffer,
    options: { maxWidth: number; maxHeight: number; maxPages: number },
  ) {
    return this.serial(async () => {
      const response = await this.request({ type: "pdf", bytes, ...options });
      return response.pages ?? [];
    });
  }

  /** One slide as a PNG at the document's exact pixel size. */
  captureSlide(
    doc: EngineDocumentInput,
    slideIndex: number,
    config: EngineConfig,
  ): Promise<Buffer> {
    return this.serial(async () => {
      const window = await this.ensure();
      window.setContentSize(doc.width, doc.height);
      await this.request({ type: "slide", doc, slideIndex, config });
      const image = await window.webContents.capturePage({
        x: 0,
        y: 0,
        width: doc.width,
        height: doc.height,
      });
      return image.toPNG();
    });
  }

  /** The whole deck as a PDF, one slide per page at the slide's size. */
  printDeck(doc: EngineDocumentInput, config: EngineConfig): Promise<Buffer> {
    return this.serial(async () => {
      const window = await this.ensure();
      window.setContentSize(doc.width, doc.height);
      await this.request({ type: "print", doc, config });
      return window.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        // Inches at 96 px per inch: the page is exactly the slide.
        pageSize: { width: doc.width / 96, height: doc.height / 96 },
      });
    });
  }

  dispose(): void {
    for (const pending of this.pending.values())
      pending.reject(new Error("Renderer closed"));
    this.pending.clear();
    this.port?.close();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.port = null;
    this.ready = null;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed() && this.ready)
      return this.ready.then(() => this.window!);
    const window = createSecureWindow(
      {
        width: 1920,
        height: 1080,
        frame: false,
        skipTaskbar: true,
        focusable: false,
        backgroundColor: "#000000",
      },
      { offscreen: true, backgroundThrottling: false },
    );
    this.window = window;
    window.webContents.on("render-process-gone", (_event, details) => {
      this.logger.error(`[render] renderer gone: ${details.reason}`);
      this.dispose();
    });
    this.ready = new Promise<void>((resolve, reject) => {
      window.webContents.once("did-finish-load", () => {
        const { port1, port2 } = new MessageChannelMain();
        port1.on("message", ({ data }) => {
          const response = data as RenderResponse | null;
          if (!response) {
            this.logger.error("[render] received an empty message");
            return;
          }
          const pending = this.pending.get(response.id);
          if (!pending) return;
          this.pending.delete(response.id);
          pending.resolve(response);
        });
        port1.start();
        this.port = port1;
        window.webContents.postMessage("engine:port", null, [port2]);
        resolve();
      });
      loadRendererPage(window, "render").catch(reject);
    });
    return this.ready.then(() => window);
  }

  private async request(body: Body): Promise<RenderResponse & { ok: true }> {
    await this.ensure();
    const id = this.nextId++;
    const response = await new Promise<RenderResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.port!.postMessage({ ...body, id });
    });
    if (!response.ok) throw new Error(response.error);
    return response;
  }
}
