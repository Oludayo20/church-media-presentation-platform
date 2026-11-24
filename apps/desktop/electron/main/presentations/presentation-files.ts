import { randomUUID } from "node:crypto";
import { open, rm, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { pptxToDocument } from "@cmp/import-export";
import type { FfTools } from "@cmp/media-processing";
import { AppError } from "@cmp/shared-types";
import {
  ENGINE_DOCUMENT_SCHEMA_VERSION,
  parseEngineDocument,
  type EngineConfig,
  type EngineDocument,
  type EngineDocumentInput,
} from "@cmp/shared-validation";
import type { JobRunner } from "../jobs/job-runner";
import type { Logger } from "../logging/logger";
import type { MediaLibrary } from "../media/media-library";
import type { WorkspaceManager } from "../workspace/workspace-manager";

/** What the render window can do (RenderHost, faked in tests). */
export interface Renderer {
  pdfToImages(
    bytes: ArrayBuffer,
    options: { maxWidth: number; maxHeight: number; maxPages: number },
  ): Promise<{ width: number; height: number; png: ArrayBuffer }[]>;
  captureSlide(
    doc: EngineDocumentInput,
    slideIndex: number,
    config: EngineConfig,
  ): Promise<Buffer>;
  printDeck(doc: EngineDocumentInput, config: EngineConfig): Promise<Buffer>;
}

export interface PresentationFilesOptions {
  workspaces: WorkspaceManager;
  jobs: JobRunner;
  media: MediaLibrary;
  renderer: Renderer;
  tools: () => FfTools;
  engineConfig: () => Promise<EngineConfig>;
  /** Saves a new presentation; returns what `presentations:get` returns. */
  save(doc: EngineDocument): Promise<{ version: number; doc: EngineDocument }>;
  isLive(): boolean;
  logger: Logger;
  chooseImportFile(): Promise<string | null>;
  chooseExportFolder(): Promise<string | null>;
  chooseExportPdf(title: string): Promise<string | null>;
}

export interface ImportReportEntry {
  kind: string;
  count: number;
}

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_PDF_PAGES = 300;

/**
 * PowerPoint/PDF import and PNG/PDF export (docs/TASKS.md Phase 7).
 * Both directions are refused during a live session: rasterising and
 * thumbnailing compete for the CPU the projector needs.
 */
export function createPresentationFiles(options: PresentationFilesOptions) {
  const { workspaces, jobs, media, renderer, logger } = options;

  function notLive(action: string): void {
    if (options.isLive())
      throw new AppError("CONFLICT", `End the live session before ${action}`);
  }

  function assetUrl(assetId: string): string {
    return `cmp-media://asset/${assetId}`;
  }

  function validate(input: EngineDocumentInput): EngineDocument {
    const parsed = parseEngineDocument(input);
    if (!parsed.success)
      throw new AppError(
        "VALIDATION_ERROR",
        "The imported presentation could not be converted",
      );
    return parsed.doc;
  }

  function sortReport(dropped: Record<string, number>): ImportReportEntry[] {
    return Object.entries(dropped)
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  }

  async function importPptx(path: string) {
    const workspace = workspaces.require();
    const { done } = jobs.start(
      {
        kind: "pptx",
        path,
        mediaDir: workspace.mediaDir,
        thumbsDir: workspace.thumbsDir,
        tools: options.tools(),
      },
      () => {},
    );
    const result = await done.catch((error: unknown) => {
      throw new AppError(
        "VALIDATION_ERROR",
        error instanceof Error
          ? error.message
          : "This PowerPoint file could not be read",
      );
    });
    if (!result.pptx)
      throw new AppError("INTERNAL", "PowerPoint import returned no deck");
    const outcomes = await media.persistAll(result.files);
    const urls = new Map<string, string>();
    for (const [zipPath, index] of Object.entries(result.pptx.mediaFiles)) {
      const assetId = outcomes[index]?.assetId;
      if (assetId) urls.set(zipPath, assetUrl(assetId));
    }
    const { doc, report } = pptxToDocument(
      result.pptx.deck,
      (zipPath) => urls.get(zipPath) ?? null,
    );
    const saved = await options.save(validate(doc));
    logger.info(
      `[presentations] imported PPTX “${doc.title}”: ${doc.slides.length} slides, ${Object.keys(report.dropped).length} kinds dropped`,
    );
    return { presentation: saved, report: sortReport(report.dropped) };
  }

  async function importPdf(path: string) {
    const workspace = workspaces.require();
    const handle = await open(path, "r");
    let bytes: Buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_PDF_BYTES)
        throw new AppError(
          "VALIDATION_ERROR",
          "PDFs must be 200 MB or smaller",
        );
      bytes = Buffer.alloc(info.size);
      await handle.read(bytes, 0, info.size, 0);
    } finally {
      await handle.close();
    }
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
      throw new AppError("VALIDATION_ERROR", "This is not a PDF file");

    const pages = await renderer
      .pdfToImages(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
        {
          maxWidth: 1920,
          maxHeight: 1080,
          maxPages: MAX_PDF_PAGES,
        },
      )
      .catch((error: unknown) => {
        throw new AppError(
          "VALIDATION_ERROR",
          error instanceof Error ? error.message : "This PDF could not be read",
        );
      });
    if (pages.length === 0)
      throw new AppError("VALIDATION_ERROR", "The PDF has no pages");

    // Store page images through the worker like any media import.
    const stem = basename(path, extname(path));
    const temps = await Promise.all(
      pages.map(async (page, index) => {
        const temp = join(workspace.mediaDir, `.pdf-${randomUUID()}.png`);
        await writeFile(temp, Buffer.from(page.png));
        return { temp, name: `${stem} — page ${index + 1}.png` };
      }),
    );
    try {
      const { done } = jobs.start(
        {
          kind: "import",
          files: temps.map((t) => t.temp),
          mediaDir: workspace.mediaDir,
          thumbsDir: workspace.thumbsDir,
          tools: options.tools(),
        },
        () => {},
      );
      const result = await done;
      const outcomes = await media.persistAll(
        result.files.map((file, index) => ({
          ...file,
          name: temps[index]?.name ?? file.name,
        })),
      );
      const report: Record<string, number> = {};
      const slides = outcomes.map((outcome, index) => {
        if (!outcome.assetId)
          report["Page that could not be imported"] =
            (report["Page that could not be imported"] ?? 0) + 1;
        return {
          id: `p${index + 1}`,
          background: outcome.assetId
            ? ({
                type: "image",
                src: assetUrl(outcome.assetId),
                fit: "contain",
              } as const)
            : ({ type: "color", value: "#000000" } as const),
          objects: [],
        };
      });
      const saved = await options.save(
        validate({
          schemaVersion: ENGINE_DOCUMENT_SCHEMA_VERSION,
          id: "pdf-import",
          title: stem.slice(0, 300) || "Imported PDF",
          width: 1920,
          height: 1080,
          slides,
        }),
      );
      return { presentation: saved, report: sortReport(report) };
    } finally {
      await Promise.all(temps.map(({ temp }) => rm(temp, { force: true })));
    }
  }

  function safeName(title: string): string {
    return (
      title
        .replace(/[\\/:*?"<>|\p{Cc}]/gu, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "Presentation"
    );
  }

  return {
    /** PPTX or PDF → a new presentation and its conversion report. */
    async importFile(path?: string) {
      workspaces.require();
      notLive("importing a presentation");
      const file = path ?? (await options.chooseImportFile());
      if (!file) return null;
      if (!isAbsolute(file))
        throw new AppError("VALIDATION_ERROR", "Import paths must be absolute");
      const ext = extname(file).toLowerCase();
      if (ext === ".pptx") return importPptx(file);
      if (ext === ".pdf") return importPdf(file);
      throw new AppError(
        "VALIDATION_ERROR",
        "Choose a PowerPoint (.pptx) or PDF file",
      );
    },

    /** One PNG per slide, at the document's pixel size, into a chosen folder. */
    async exportImages(input: EngineDocumentInput): Promise<{ count: number }> {
      workspaces.require();
      notLive("exporting");
      const doc = validate(input);
      const folder = await options.chooseExportFolder();
      if (!folder) return { count: 0 };
      const config = await options.engineConfig();
      const name = safeName(doc.title);
      const digits = String(doc.slides.length).length;
      for (const [index] of doc.slides.entries()) {
        const png = await renderer.captureSlide(doc, index, config);
        await writeFile(
          join(
            folder,
            `${name} - ${String(index + 1).padStart(Math.max(2, digits), "0")}.png`,
          ),
          png,
        );
      }
      logger.info(
        `[presentations] exported ${doc.slides.length} PNGs to ${folder}`,
      );
      return { count: doc.slides.length };
    },

    /** The deck as a PDF, one slide per page. */
    async exportPdf(input: EngineDocumentInput): Promise<{ saved: boolean }> {
      workspaces.require();
      notLive("exporting");
      const doc = validate(input);
      const path = await options.chooseExportPdf(safeName(doc.title));
      if (!path) return { saved: false };
      await writeFile(
        path,
        await renderer.printDeck(doc, await options.engineConfig()),
      );
      return { saved: true };
    },
  };
}

export type PresentationFiles = ReturnType<typeof createPresentationFiles>;
