import type { EngineConfig, EngineDocumentInput } from "./engine-protocol";

/**
 * Messages between main and the hidden render window (`render.html`), which
 * rasterises PDF pages with pdf.js and lays out slides with the real engine
 * for PNG/PDF export. Types only.
 */
export type RenderRequest =
  | {
      id: number;
      type: "pdf";
      bytes: ArrayBuffer;
      maxWidth: number;
      maxHeight: number;
      maxPages: number;
    }
  | {
      id: number;
      type: "slide";
      doc: EngineDocumentInput;
      slideIndex: number;
      config: EngineConfig;
    }
  | {
      id: number;
      type: "print";
      doc: EngineDocumentInput;
      config: EngineConfig;
    };

export type RenderResponse =
  | {
      id: number;
      ok: true;
      pages?: { width: number; height: number; png: ArrayBuffer }[];
    }
  | { id: number; ok: false; error: string };
