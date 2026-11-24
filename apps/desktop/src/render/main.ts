/**
 * Hidden render window (never shown). Rasterises PDF pages with pdf.js and
 * lays out slides with the real presentation engine so main can capture
 * PNGs (`capturePage`) and print PDFs (`printToPDF`) — pixel-identical to
 * the projector. Untrusted PDFs are parsed here, in a sandboxed renderer,
 * not in the main process.
 */
import * as pdfjs from "pdfjs-dist";
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs";
import { createPresentationEngine } from "@cmp/presentation-engine";
import type { RenderRequest, RenderResponse } from "@cmp/shared-validation";
import { listenForEnginePort } from "../lib/engine-port";

// Run pdf.js's worker code on this thread: file:// pages cannot start
// module workers, and this window does nothing else.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

const root = document.getElementById("render")!;
Object.assign(document.body.style, {
  margin: "0",
  background: "#000",
  overflow: "hidden",
});
let engines: { destroy(): void }[] = [];

const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

async function renderPdf(request: Extract<RenderRequest, { type: "pdf" }>) {
  // pdf.js 6 no longer evaluates code from PDFs (no `isEvalSupported`),
  // which is what the strict CSP requires.
  const task = pdfjs.getDocument({
    data: new Uint8Array(request.bytes),
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > request.maxPages)
      throw new Error(`PDFs over ${request.maxPages} pages are not supported`);
    const pages: { width: number; height: number; png: ArrayBuffer }[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        request.maxWidth / base.width,
        request.maxHeight / base.height,
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport,
      }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("Could not encode the page")),
          "image/png",
        ),
      );
      pages.push({
        width: canvas.width,
        height: canvas.height,
        png: await blob.arrayBuffer(),
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

function reset(width: number) {
  engines.forEach((engine) => engine.destroy());
  engines = [];
  root.replaceChildren();
  Object.assign(root.style, { width: `${width}px`, position: "relative" });
}

/** One slide filling the window, media decoded and fonts loaded. */
async function renderSlide(request: Extract<RenderRequest, { type: "slide" }>) {
  reset(request.doc.width);
  await renderInto(
    page(request.doc.width, request.doc.height),
    request,
    request.slideIndex,
  );
  await document.fonts.ready;
  await frames();
}

/** Every slide as a page-sized block, one per printed page. */
async function renderPrint(request: Extract<RenderRequest, { type: "print" }>) {
  reset(request.doc.width);
  await Promise.all(
    request.doc.slides.map((_, index) => {
      const block = page(request.doc.width, request.doc.height);
      block.style.breakAfter =
        index < request.doc.slides.length - 1 ? "page" : "auto";
      return renderInto(block, request, index);
    }),
  );
  await document.fonts.ready;
  await frames();
}

function page(width: number, height: number): HTMLElement {
  const block = document.createElement("div");
  Object.assign(block.style, {
    position: "relative",
    width: `${width}px`,
    height: `${height}px`,
    overflow: "hidden",
  });
  root.append(block);
  return block;
}

async function renderInto(
  block: HTMLElement,
  request: {
    doc: Extract<RenderRequest, { type: "slide" }>["doc"];
    config: Extract<RenderRequest, { type: "slide" }>["config"];
  },
  index: number,
) {
  const engine = createPresentationEngine(block, {
    mode: "static",
    mediaTimeoutMs: 4000,
  });
  engines.push(engine);
  await engine.apply({
    seq: 1,
    type: "config",
    config: { ...request.config, defaultTransition: { type: "cut", ms: 0 } },
  });
  await engine.apply({
    seq: 2,
    type: "load",
    doc: {
      ...request.doc,
      slides: request.doc.slides.map(({ transition: _t, ...slide }) => slide),
    },
    startSlide: index,
  });
}

listenForEnginePort((port) => {
  port.onmessage = async (event: MessageEvent<RenderRequest>) => {
    const request = event.data;
    let response: RenderResponse;
    try {
      if (request.type === "pdf") {
        const pages = await renderPdf(request);
        response = { id: request.id, ok: true, pages };
      } else if (request.type === "slide") {
        await renderSlide(request);
        response = { id: request.id, ok: true };
      } else {
        await renderPrint(request);
        response = { id: request.id, ok: true };
      }
    } catch (error) {
      response = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    // Structured clone, not a transfer list: transferred ArrayBuffers do not
    // survive the hop into Electron's MessagePortMain (they arrive as null).
    port.postMessage(response);
  };
});
