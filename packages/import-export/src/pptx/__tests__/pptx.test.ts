import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { engineDocumentSchema } from "@cmp/shared-validation/engine-protocol";
import { openZipFile } from "../../zip";
import { parsePptx, pptxToDocument, type PptxDeck } from "../index";
import {
  buildPptx,
  PNG,
  textBox,
  writeZip,
  xfrm,
  type DeckSpec,
} from "./build-pptx";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmp-pptx-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const LIMITS = { maxEntries: 1000, maxTotalBytes: 50 * 1024 * 1024 };

async function deck(spec: DeckSpec, name = "Sunday.pptx"): Promise<PptxDeck> {
  const path = join(dir, name);
  buildPptx(path, spec);
  return parsePptx(await openZipFile(path, LIMITS), { fileName: name });
}

const EMU = 6858000 / 1080; // EMU per document px on a 16:9 deck
const px = (value: number) => Math.round(value * EMU);

describe("text and layout", () => {
  it("converts a text box: frame, size, colour, bold, alignment, anchor, background", async () => {
    const result = await deck({
      title: "Harvest Sunday",
      slides: [
        {
          tree: textBox(
            2,
            xfrm(px(160), px(380), px(1600), px(320)),
            '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>GOD IS FAITHFUL</a:t></a:r></a:p><a:p><a:r><a:rPr sz="4400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Line</a:t></a:r><a:br/><a:r><a:rPr sz="4400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>break</a:t></a:r></a:p>',
            { anchor: "ctr" },
          ),
          extra: "",
        },
      ].map((s) => ({ ...s, tree: s.tree })),
      masterBg:
        '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="101820"/></a:solidFill></p:bgPr></p:bg>',
    });
    expect(result).toMatchObject({
      title: "Harvest Sunday",
      width: 1920,
      height: 1080,
    });
    const [slide] = result.slides;
    expect(slide!.background).toEqual({ type: "color", value: "#101820" });
    expect(slide!.objects).toEqual([
      {
        kind: "text",
        frame: { x: 160, y: 380, w: 1600, h: 320 },
        content: "GOD IS FAITHFUL\nLine\nbreak",
        style: {
          fontFamily: '"Arial", Inter, system-ui, sans-serif',
          fontSize: 88, // 44 pt on a 1080-px-high 16:9 deck
          fontWeight: 700,
          color: "#FFFFFF",
          align: "center",
          vAlign: "middle",
          lineHeight: 1.15,
        },
      },
    ]);
  });

  it("4:3 decks keep their aspect ratio", async () => {
    const result = await deck({
      cx: 9144000,
      cy: 6858000,
      slides: [{ tree: "" }],
    });
    expect(result).toMatchObject({ width: 1440, height: 1080 });
  });

  it("placeholders inherit position from the layout and style from the master and theme", async () => {
    const result = await deck({
      slides: [
        {
          tree:
            '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Welcome</a:t></a:r></a:p></p:txBody></p:sp>' +
            '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>First point</a:t></a:r></a:p><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>No bullet</a:t></a:r></a:p></p:txBody></p:sp>',
        },
      ],
      layoutTree:
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(px(100), px(50), px(1720), px(200))}</p:spPr></p:sp>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(px(100), px(300), px(1720), px(700))}</p:spPr></p:sp>`,
      txStyles:
        '<p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="6000"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
        '<p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="3200"><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle></p:txStyles>',
    });
    const [title, body] = result.slides[0]!.objects as Extract<
      PptxDeck["slides"][number]["objects"][number],
      { kind: "text" }
    >[];
    expect(title).toMatchObject({
      frame: { x: 100, y: 50, w: 1720, h: 200 },
      content: "Welcome",
      style: {
        fontSize: 120,
        color: "#1F2A44",
        align: "center",
        fontFamily: '"Montserrat", Inter, system-ui, sans-serif',
      },
    });
    expect(body).toMatchObject({
      frame: { x: 100, y: 300 },
      content: "• First point\nNo bullet",
      style: { fontSize: 64 },
    });
    expect(body!.style.color).toMatch(/^#2[0-9A-F]{5}$/); // accent1 darkened by lumMod 75%
  });

  it("flattens groups with their child transform and reports mixed formatting", async () => {
    const result = await deck({
      slides: [
        {
          tree:
            `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${px(1000)}" y="${px(500)}"/><a:ext cx="${px(400)}" cy="${px(200)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(800)}" cy="${px(400)}"/></a:xfrm></p:grpSpPr>` +
            textBox(
              10,
              xfrm(px(200), px(100), px(400), px(200)),
              '<a:p><a:r><a:rPr sz="2000"/><a:t>Big</a:t></a:r><a:r><a:rPr sz="1000"/><a:t> small</a:t></a:r></a:p>',
            ) +
            "</p:grpSp>",
        },
      ],
    });
    expect(result.slides[0]!.objects[0]).toMatchObject({
      frame: { x: 1100, y: 550, w: 200, h: 100 },
      content: "Big small",
    });
    expect(result.report.dropped).toEqual({
      "Mixed text formatting (simplified)": 1,
    });
  });
});

describe("media, backgrounds and transitions", () => {
  const pic = (id: number, embed: string, extra = "") =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${embed}"/>${extra}</p:blipFill><p:spPr>${xfrm(0, 0, px(960), px(540))}</p:spPr></p:pic>`;

  it("keeps pictures, reports EMF and crops, uses picture backgrounds and fades", async () => {
    const result = await deck({
      slides: [
        {
          tree:
            pic(4, "rIdImg") +
            pic(5, "rIdEmf") +
            pic(6, "rIdImg", '<a:srcRect l="10000"/>'),
          extra: '<p:transition spd="fast"><p:fade/></p:transition>',
          rels: [
            { id: "rIdImg", type: "image", target: "../media/image1.png" },
            { id: "rIdEmf", type: "image", target: "../media/image2.emf" },
          ],
        },
        {
          tree: "",
          extra: "<p:transition><p:push/></p:transition>",
        },
      ],
      masterBg:
        '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdBg"/></a:blipFill></p:bgPr></p:bg>',
      masterRels: [{ id: "rIdBg", type: "image", target: "../media/bg.png" }],
      media: {
        "image1.png": PNG,
        "image2.emf": Buffer.from("emf"),
        "bg.png": PNG,
      },
    });
    const [first, second] = result.slides;
    expect(first!.objects.map((o) => o.kind)).toEqual(["image", "image"]);
    expect(first!.objects[0]).toMatchObject({
      frame: { x: 0, y: 0, w: 960, h: 540 },
      media: "ppt/media/image1.png",
    });
    expect(first!.transition).toEqual({ type: "fade", ms: 500 });
    expect(second!.transition).toEqual({ type: "cut", ms: 0 });
    // Inherited from the master's picture background.
    expect(first!.background).toEqual({
      type: "image",
      media: "ppt/media/bg.png",
    });
    expect(result.report.dropped).toMatchObject({
      "Picture in EMF format": 1,
      "Picture crop (whole image shown)": 1,
      "Slide transition (simplified to cut)": 1,
    });
    expect(result.media.sort()).toEqual([
      "ppt/media/bg.png",
      "ppt/media/image1.png",
    ]);
  });

  it("embedded video is kept; linked video and audio are reported", async () => {
    const video = (id: number, rel: string, tag = "a:videoFile r:link") =>
      `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="V"/><p:cNvPicPr/><p:nvPr><${tag}="${rel}"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rIdPoster"/></p:blipFill><p:spPr>${xfrm(0, 0, px(1920), px(1080))}</p:spPr></p:pic>`;
    const result = await deck({
      slides: [
        {
          tree:
            video(4, "rIdVid") +
            video(5, "rIdLink") +
            video(6, "rIdA", "a:audioFile r:link"),
          rels: [
            { id: "rIdVid", type: "video", target: "../media/media1.mp4" },
            {
              id: "rIdLink",
              type: "video",
              target: "https://example.com/v.mp4",
              external: true,
            },
            { id: "rIdA", type: "audio", target: "../media/media2.mp3" },
            { id: "rIdPoster", type: "image", target: "../media/image1.png" },
          ],
        },
      ],
      media: { "media1.mp4": Buffer.from("mp4"), "image1.png": PNG },
    });
    expect(result.slides[0]!.objects).toEqual([
      {
        kind: "video",
        frame: { x: 0, y: 0, w: 1920, h: 1080 },
        media: "ppt/media/media1.mp4",
      },
    ]);
    expect(result.report.dropped).toMatchObject({
      "Linked (not embedded) video": 1,
      "Audio clip": 1,
    });
  });

  it("gradient backgrounds and solid shapes", async () => {
    const result = await deck({
      slides: [
        {
          tree:
            `<p:sp><p:nvSpPr><p:cNvPr id="2" name="R"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, px(900), px(1920), px(180))}<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="E5484D"><a:alpha val="50000"/></a:srgbClr></a:solidFill></p:spPr></p:sp>` +
            `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Star"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, px(100), px(100))}<a:prstGeom prst="star5"/><a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill></p:spPr></p:sp>`,
          extra: "",
        },
      ],
      masterBg:
        '<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="100000"><a:srgbClr val="000000"/></a:gs><a:gs pos="0"><a:srgbClr val="1B1F3B"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></p:bgPr></p:bg>',
    });
    expect(result.slides[0]!.background).toEqual({
      type: "gradient",
      angle: 180,
      stops: ["#1B1F3B", "#000000"],
    });
    expect(result.slides[0]!.objects).toEqual([
      {
        kind: "shape",
        frame: { x: 0, y: 900, w: 1920, h: 180 },
        fill: "#E5484D80",
        radius: 0,
      },
    ]);
    expect(result.report.dropped).toEqual({ "Shape (star5)": 1 });
  });
});

describe("conversion report", () => {
  it("counts tables, charts, diagrams, connectors, hidden slides, notes and animations", async () => {
    const frame = (uri: string) =>
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="F"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></p:xfrm><a:graphic><a:graphicData uri="${uri}"/></a:graphic></p:graphicFrame>`;
    const result = await deck({
      slides: [
        {
          tree:
            frame("http://schemas.openxmlformats.org/drawingml/2006/table") +
            frame("http://schemas.openxmlformats.org/drawingml/2006/chart") +
            frame("http://schemas.openxmlformats.org/drawingml/2006/diagram") +
            '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="8" name="L"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr/></p:cxnSp>' +
            `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="p14">${textBox(11, xfrm(0, 0, 10, 10), "<a:p><a:r><a:t>new</a:t></a:r></a:p>")}</mc:Choice><mc:Fallback>${textBox(12, xfrm(0, 0, px(500), px(100)), "<a:p><a:r><a:t>fallback</a:t></a:r></a:p>")}</mc:Fallback></mc:AlternateContent>`,
          extra: "<p:timing/>",
          rels: [
            {
              id: "rIdN",
              type: "notesSlide",
              target: "../notesSlides/notesSlide1.xml",
            },
          ],
        },
        { tree: "", attrs: 'show="0"' },
      ],
    });
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0]!.objects).toEqual([
      expect.objectContaining({ kind: "text", content: "fallback" }),
    ]);
    expect(result.report.dropped).toEqual({
      Table: 1,
      Chart: 1,
      "SmartArt diagram": 1,
      "Line or connector": 1,
      "Animations (removed)": 1,
      "Speaker notes (not imported)": 1,
      "Hidden slide (skipped)": 1,
    });
  });

  it("builds a valid engine document and reports media that failed to import", async () => {
    const result = await deck({
      slides: [
        {
          tree:
            textBox(
              2,
              xfrm(0, 0, px(500), px(100)),
              "<a:p><a:r><a:t>Hello</a:t></a:r></a:p>",
            ) +
            `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill><p:spPr>${xfrm(0, 0, 10, 10)}</p:spPr></p:pic>`,
          extra: "<p:transition><p:fade/></p:transition>",
          rels: [
            { id: "rIdImg", type: "image", target: "../media/image1.png" },
          ],
        },
      ],
      media: { "image1.png": PNG },
    });
    const ok = pptxToDocument(
      result,
      () => "cmp-media://asset/01JD0000000000000000000001",
    );
    const doc = engineDocumentSchema.parse(ok.doc);
    expect(doc.slides[0]!.objects.map((o) => o.type)).toEqual([
      "text",
      "image",
    ]);
    expect(doc.slides[0]!.transition).toEqual({ type: "fade", ms: 700 });
    const failed = pptxToDocument(result, () => null);
    expect(failed.doc.slides[0]!.objects).toHaveLength(1);
    expect(failed.report.dropped).toEqual({
      "Picture that could not be imported": 1,
    });
  });
});

describe("hostile files", () => {
  it("refuses non-PPTX zips and non-zips", async () => {
    const zip = join(dir, "other.zip");
    writeZip(zip, { "readme.txt": "hi" });
    await expect(
      parsePptx(await openZipFile(zip, LIMITS), { fileName: "other.zip" }),
    ).rejects.toThrow(/not a PowerPoint/);
    const text = join(dir, "fake.pptx");
    writeFileSync(text, "not a zip at all");
    await expect(openZipFile(text, LIMITS)).rejects.toThrow(/Not a ZIP/);
  });

  it("refuses DOCTYPE/ENTITY declarations (XXE, billion laughs)", async () => {
    const path = join(dir, "evil.pptx");
    writeZip(path, {
      "ppt/presentation.xml":
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><p:presentation>&e;</p:presentation>',
    });
    await expect(
      parsePptx(await openZipFile(path, LIMITS), { fileName: "evil.pptx" }),
    ).rejects.toThrow(/DOCTYPE/);
  });

  it("stops a decompression bomb at the limit even when the header lies", async () => {
    const path = join(dir, "bomb.pptx");
    writeZip(
      path,
      { "ppt/presentation.xml": Buffer.alloc(30 * 1024 * 1024, 0x20) },
      { deflate: true },
    );
    const zip = await openZipFile(path, LIMITS);
    await expect(
      zip.read("ppt/presentation.xml", 20 * 1024 * 1024),
    ).rejects.toThrow(/larger than allowed/);
    const small = await openZipFile(path, {
      maxEntries: 10,
      maxTotalBytes: 1024,
    });
    await expect(
      small.read("ppt/presentation.xml", 64 * 1024 * 1024),
    ).rejects.toThrow(/expands to more/);

    // The headers claim 100 bytes; only the streaming counter can stop it.
    const liar = join(dir, "liar.pptx");
    writeZip(
      liar,
      { "ppt/presentation.xml": Buffer.alloc(30 * 1024 * 1024, 0x20) },
      { deflate: true, lieAboutSize: 100 },
    );
    const lying = await openZipFile(liar, LIMITS);
    expect(lying.size("ppt/presentation.xml")).toBe(100);
    await expect(
      lying.read("ppt/presentation.xml", 1024 * 1024),
    ).rejects.toThrow(/larger than allowed/);
    await expect(
      lying.extractTo(
        "ppt/presentation.xml",
        join(dir, "out.bin"),
        1024 * 1024,
      ),
    ).rejects.toThrow(/larger than allowed/);
  });

  it("refuses archives with too many entries", async () => {
    const path = join(dir, "many.pptx");
    writeZip(
      path,
      Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, "x"])),
    );
    await expect(
      openZipFile(path, { maxEntries: 10, maxTotalBytes: 1e9 }),
    ).rejects.toThrow(/too many parts/);
  });
});
