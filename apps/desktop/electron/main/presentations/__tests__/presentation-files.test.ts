import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EngineConfig } from "@cmp/shared-validation";
import { parseEngineDocument } from "@cmp/shared-validation";
import {
  buildPptx,
  PNG,
  textBox,
  xfrm,
} from "../../../../../../packages/import-export/src/pptx/__tests__/build-pptx";
import { createConfigStore } from "../../config/config-store";
import { JobRunner } from "../../jobs/job-runner";
import { inProcessWorker } from "../../jobs/__tests__/in-process-worker";
import { silentLogger } from "../../logging/logger";
import { createMediaLibrary } from "../../media/media-library";
import {
  createWorkspaceManager,
  type WorkspaceManager,
} from "../../workspace/workspace-manager";
import {
  createPresentationFiles,
  type PresentationFiles,
  type Renderer,
} from "../presentation-files";

const CONFIG: EngineConfig = {
  fallbackBackground: { type: "color", value: "#000" },
  logoSrc: null,
  logoText: null,
  safeAreaPct: 5,
  defaultTransition: { type: "cut", ms: 0 },
};

let root: string;
let workspaces: WorkspaceManager;
let files: PresentationFiles;
let live: boolean;
let exportFolder: string | null;
let exportPdf: string | null;
const captured: number[] = [];

const renderer: Renderer = {
  pdfToImages: async () => [
    { width: 1920, height: 1080, png: new Uint8Array(PNG).buffer },
    { width: 1920, height: 1080, png: new Uint8Array([...PNG, 1]).buffer },
  ],
  captureSlide: async (_doc, index) => {
    captured.push(index);
    return PNG;
  },
  printDeck: async () => Buffer.from("%PDF-1.7 fake"),
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "cmp-files-"));
  workspaces = createWorkspaceManager({
    workspacesDir: join(root, "w"),
    backupsDir: join(root, "b"),
    appVersion: "1",
    config: createConfigStore(join(root, "config.json"), silentLogger),
    logger: silentLogger,
  });
  await workspaces.create("Grace");
  live = false;
  exportFolder = join(root, "export");
  exportPdf = join(root, "deck.pdf");
  captured.length = 0;
  const jobs = new JobRunner(inProcessWorker, silentLogger);
  const tools = { ffmpeg: null, ffprobe: null };
  files = createPresentationFiles({
    workspaces,
    jobs,
    media: createMediaLibrary({
      workspaces,
      jobs,
      tools: () => tools,
      logger: silentLogger,
      pushProgress: () => {},
      pushChanged: () => {},
      chooseFiles: async () => [],
    }),
    renderer,
    tools: () => tools,
    engineConfig: async () => CONFIG,
    isLive: () => live,
    logger: silentLogger,
    save: async (doc) => {
      const saved = await workspaces.require().presentations.save(null, 0, doc);
      const parsed = parseEngineDocument(saved.snapshot);
      if (!parsed.success) throw new Error(parsed.error);
      return { version: saved.version, doc: parsed.doc };
    },
    chooseImportFile: async () => null,
    chooseExportFolder: async () => exportFolder,
    chooseExportPdf: async () => exportPdf,
  });
});
afterEach(() => {
  workspaces.close();
  rmSync(root, { recursive: true, force: true });
});

const EMU = 6858000 / 1080;
const px = (value: number) => Math.round(value * EMU);

describe("PowerPoint import", () => {
  it("creates a presentation with library media and a conversion report", async () => {
    const path = join(root, "Harvest Sunday.pptx");
    buildPptx(path, {
      slides: [
        {
          tree:
            textBox(
              2,
              xfrm(px(160), px(380), px(1600), px(320)),
              '<a:p><a:r><a:rPr sz="4400"/><a:t>Welcome</a:t></a:r></a:p>',
            ) +
            `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill><p:spPr>${xfrm(0, 0, px(960), px(540))}</p:spPr></p:pic>` +
            `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="F"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"/></a:graphic></p:graphicFrame>`,
          rels: [
            { id: "rIdImg", type: "image", target: "../media/image1.png" },
          ],
        },
      ],
      media: { "image1.png": PNG },
    });
    const result = await files.importFile(path);
    expect(result!.presentation.doc).toMatchObject({
      title: "Harvest Sunday",
      width: 1920,
      height: 1080,
    });
    const objects = result!.presentation.doc.slides[0]!.objects;
    expect(objects.map((object) => object.type)).toEqual(["text", "image"]);
    const image = objects[1] as { src: string };
    expect(image.src).toMatch(/^cmp-media:\/\/asset\/[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(result!.report).toEqual([{ kind: "Table", count: 1 }]);
    // The picture is now a library asset.
    const assets = await workspaces.require().library.list({ limit: 10 });
    expect(assets.items).toHaveLength(1);
    // No temp files are left in the media store.
    expect(
      readdirSync(workspaces.require().mediaDir).filter((name) =>
        name.startsWith("."),
      ),
    ).toEqual([]);
  });

  it("reports a broken deck as a validation error", async () => {
    const path = join(root, "broken.pptx");
    writeFileSync(path, "not a zip");
    await expect(files.importFile(path)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("PDF import", () => {
  it("makes one full-slide picture per page", async () => {
    const path = join(root, "Order of service.pdf");
    writeFileSync(path, "%PDF-1.7\nfake");
    const result = await files.importFile(path);
    expect(result!.presentation.doc.title).toBe("Order of service");
    expect(
      result!.presentation.doc.slides.map((slide) => slide.background.type),
    ).toEqual(["image", "image"]);
    expect(result!.report).toEqual([]);
  });

  it("rejects files that are not PDFs", async () => {
    const path = join(root, "fake.pdf");
    writeFileSync(path, "hello");
    await expect(files.importFile(path)).rejects.toThrow(/not a PDF/);
  });
});

describe("guards", () => {
  it("refuses other file types, relative paths and imports during a live session", async () => {
    await expect(files.importFile(join(root, "x.key"))).rejects.toThrow(
      /PowerPoint/,
    );
    await expect(files.importFile("relative.pptx")).rejects.toThrow(/absolute/);
    live = true;
    await expect(files.importFile(join(root, "x.pptx"))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("returns null when the picker is cancelled", async () => {
    expect(await files.importFile()).toBeNull();
  });
});

describe("export", () => {
  const doc = {
    schemaVersion: "cmp.presentation/v1" as const,
    id: "d",
    title: 'Sunday: "Morning"',
    width: 1920,
    height: 1080,
    slides: Array.from({ length: 3 }, (_, i) => ({
      id: `s${i}`,
      background: { type: "color" as const, value: "#000000" },
      objects: [],
    })),
  };

  it("writes one numbered PNG per slide with a safe file name", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(exportFolder!, { recursive: true });
    expect(await files.exportImages(doc)).toEqual({ count: 3 });
    expect(captured).toEqual([0, 1, 2]);
    expect(readdirSync(exportFolder!).sort()).toEqual([
      "Sunday Morning - 01.png",
      "Sunday Morning - 02.png",
      "Sunday Morning - 03.png",
    ]);
  });

  it("writes the PDF, and does nothing when the dialog is cancelled", async () => {
    expect(await files.exportPdf(doc)).toEqual({ saved: true });
    expect(existsSync(exportPdf!)).toBe(true);
    exportPdf = null;
    expect(await files.exportPdf(doc)).toEqual({ saved: false });
    exportFolder = null;
    expect(await files.exportImages(doc)).toEqual({ count: 0 });
  });
});
