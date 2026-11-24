import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import {
  buildPptx,
  PNG,
  textBox,
  xfrm,
} from "../../../../packages/import-export/src/pptx/__tests__/build-pptx";
import { completeOnboarding, launchApp, tempUserData } from "./fixtures";

/**
 * Phase 7: PowerPoint/PDF import and PNG/PDF export through the real hidden
 * render window (pdf.js, the engine, capturePage, printToPDF), plus fonts.
 */

const EMU = 6858000 / 1080;
const px = (value: number) => Math.round(value * EMU);

async function stubSaveDialog(app: ElectronApplication, filePath: string) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog;
  }, filePath);
}

async function stubOpenDialog(app: ElectronApplication, paths: string[]) {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: chosen,
    })) as typeof dialog.showOpenDialog;
  }, paths);
}

const pngSize = (bytes: Buffer) => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
});

test("Phase 7: PowerPoint → presentation → PNG + PDF export → PDF import", async () => {
  const userData = tempUserData();
  const { app, page, consoleErrors } = await launchApp(userData.dir);
  try {
    await completeOnboarding(page);
    await page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("button", { name: "Presentations" })
      .click();

    // ── PowerPoint import, through the UI's file picker ──
    const pptx = join(userData.dir, "Harvest Sunday.pptx");
    buildPptx(pptx, {
      slides: [
        {
          tree:
            textBox(
              2,
              xfrm(px(160), px(380), px(1600), px(320)),
              '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Harvest Thanksgiving</a:t></a:r></a:p>',
            ) +
            `<p:pic><p:nvPicPr><p:cNvPr id="4" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill><p:spPr>${xfrm(px(40), px(40), px(200), px(200))}</p:spPr></p:pic>` +
            `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="F"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>`,
          rels: [
            { id: "rIdImg", type: "image", target: "../media/image1.png" },
          ],
          extra: "<p:transition><p:fade/></p:transition>",
        },
        {
          tree: textBox(
            2,
            xfrm(px(160), px(380), px(1600), px(320)),
            '<a:p><a:r><a:rPr sz="3600"/><a:t>Thank you</a:t></a:r></a:p>',
          ),
        },
      ],
      masterBg:
        '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="12263A"/></a:solidFill></p:bgPr></p:bg>',
      media: { "image1.png": PNG },
    });
    await stubOpenDialog(app, [pptx]);
    await page
      .getByRole("button", { name: "Import PowerPoint or PDF…" })
      .click();
    const report = page.getByTestId("import-report");
    await expect(report).toContainText(
      "Some things could not be brought across",
    );
    await expect(report).toContainText("Chart");
    const title = await page.evaluate(async () => {
      const list = await window.cmp.presentations.list();
      return list.success ? list.data.map((item) => item.title) : [];
    });
    expect(title).toContain("Harvest Sunday");

    const doc = await page.evaluate(async () => {
      const list = await window.cmp.presentations.list();
      if (!list.success) throw new Error("list");
      const found = list.data.find((item) => item.title === "Harvest Sunday")!;
      const saved = await window.cmp.presentations.get({ id: found.id });
      if (!saved.success) throw new Error("get");
      return saved.data.doc;
    });
    expect(doc.slides).toHaveLength(2);
    // Document order (z-order) is kept: the text box, then the picture.
    expect(doc.slides[0]!.objects.map((object) => object.type)).toEqual([
      "text",
      "image",
    ]);

    // ── PNG export: one 1920×1080 image per slide ──
    const folder = join(userData.dir, "png");
    mkdirSync(folder);
    await stubOpenDialog(app, [folder]);
    const images = await page.evaluate(
      (d) => window.cmp.presentations.exportImages({ doc: d }),
      doc,
    );
    expect(images).toEqual({ success: true, data: { count: 2 } });
    const pngs = readdirSync(folder).sort();
    expect(pngs).toEqual([
      "Harvest Sunday - 01.png",
      "Harvest Sunday - 02.png",
    ]);
    for (const file of pngs)
      expect(pngSize(readFileSync(join(folder, file)))).toEqual({
        width: 1920,
        height: 1080,
      });
    // The first slide rendered real content, not a blank frame.
    expect(readFileSync(join(folder, pngs[0]!)).length).toBeGreaterThan(5000);

    // ── PDF export: one page per slide ──
    const pdf = join(userData.dir, "Harvest Sunday.pdf");
    await stubSaveDialog(app, pdf);
    expect(
      await page.evaluate(
        (d) => window.cmp.presentations.exportPdf({ doc: d }),
        doc,
      ),
    ).toEqual({ success: true, data: { saved: true } });
    const pdfBytes = readFileSync(pdf);
    expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      pdfBytes.toString("latin1").match(/\/Type\s*\/Page(?!s)/g),
    ).toHaveLength(2);

    // ── PDF import (real pdf.js in the render window): one picture per page ──
    const imported = await page.evaluate(
      (path) => window.cmp.presentations.importFile({ path }),
      pdf,
    );
    expect(imported.success).toBe(true);
    const pdfDoc = imported.success ? imported.data!.presentation.doc : null;
    expect(pdfDoc!.slides.map((slide) => slide.background.type)).toEqual([
      "image",
      "image",
    ]);
    expect(pdfDoc!.title).toBe("Harvest Sunday");

    // Imports and exports are refused while live.
    await page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("button", { name: "Live" })
      .click();
    await page.getByRole("button", { name: "Go live (preview only)" }).click();
    const refused = await page.evaluate(
      (path) => window.cmp.presentations.importFile({ path }),
      pdf,
    );
    expect(refused).toMatchObject({
      success: false,
      error: { code: "CONFLICT" },
    });

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
    userData.cleanup();
  }
});

const SYSTEM_FONT = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
].find((path) => existsSync(path));

test("Phase 7: fonts need a licence acknowledgement, then register with FontFace", async () => {
  test.skip(!SYSTEM_FONT, "no system TrueType font to import on this machine");
  const userData = tempUserData();
  const { page } = await launchApp(userData.dir);
  try {
    await completeOnboarding(page);
    const font = join(userData.dir, "ChurchFont.ttf");
    copyFileSync(SYSTEM_FONT!, font);

    const refused = await page.evaluate(
      (path) =>
        (window.cmp.fonts.import as (input: unknown) => Promise<unknown>)({
          paths: [path],
        }),
      font,
    );
    expect(refused).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });

    await page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("button", { name: "Settings" })
      .click();
    await expect(
      page.getByRole("button", { name: "Import fonts…" }),
    ).toBeDisabled();
    await page.evaluate(
      (path) => window.cmp.fonts.import({ acknowledged: true, paths: [path] }),
      font,
    );
    // The import runs in the worker; wait for it to land.
    const listed = () =>
      page.evaluate(async () => {
        const fonts = await window.cmp.fonts.list();
        return fonts.success ? fonts.data.map((f) => f.family) : [];
      });
    await expect.poll(listed, { timeout: 10_000 }).toHaveLength(1);
    const family = (await listed())[0]!;
    await expect(
      page.getByRole("list", { name: "Imported fonts" }),
    ).toContainText(family);
    expect(family).toMatch(/Arial|DejaVu/);
    // Registered in the operator window and actually loaded from cmp-media://.
    await expect
      .poll(() =>
        page.evaluate(
          (name) =>
            [...document.fonts].some(
              (face) =>
                face.family.replace(/"/g, "") === name &&
                face.status === "loaded",
            ),
          family,
        ),
      )
      .toBe(true);
  } finally {
    await page
      .context()
      .browser()
      ?.close()
      .catch(() => undefined);
    userData.cleanup();
  }
});
