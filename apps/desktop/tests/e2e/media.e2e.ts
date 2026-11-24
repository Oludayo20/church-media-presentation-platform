import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  CLIP_MP4,
  completeOnboarding,
  launchApp,
  PNG_1X1,
  stubOpenDialog,
  tempUserData,
} from "./fixtures";

/**
 * Phase 4 end to end. OS-level file drops cannot be synthesised, so imports
 * go through `media:import` with absolute paths — exactly what the drop
 * handler sends after `window.cmp.files.pathFor(file)`.
 */

async function importPaths(page: Page, paths: string[]): Promise<void> {
  const result = await page.evaluate(
    (paths) => window.cmp.media.import({ paths }),
    paths,
  );
  expect(result.success).toBe(true);
}

async function items(page: Page) {
  return page.evaluate(async () => {
    const result = await window.cmp.media.list({});
    if (!result.success) throw new Error(result.error.message);
    return result.data.items;
  });
}

test("Phase 4: import, dedupe, thumbnails, organise, missing files and protected delete", async () => {
  const userData = tempUserData();
  const { app, page, consoleErrors } = await launchApp(userData.dir);
  try {
    await completeOnboarding(page);
    await page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("button", { name: "Media" })
      .click();
    await expect(page.getByText("Your library is empty")).toBeVisible();
    expect(await page.evaluate(() => typeof window.cmp.files.pathFor)).toBe(
      "function",
    );

    // Drop zone appears while files are dragged over the library.
    await page
      .getByRole("region", { name: "Library" })
      .dispatchEvent("dragenter", {
        dataTransfer: await page.evaluateHandle(() => {
          const transfer = new DataTransfer();
          transfer.items.add(new File(["x"], "x.png", { type: "image/png" }));
          return transfer;
        }),
      });
    await expect(page.getByTestId("drop-zone")).toBeVisible();
    await page.getByRole("region", { name: "Library" }).dispatchEvent("drop", {
      dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    });
    await expect(page.getByTestId("drop-zone")).toBeHidden();

    // ── Import: a video, an image and something unsupported ──
    const png = join(userData.dir, "flyer.png");
    const junk = join(userData.dir, "notes.txt");
    writeFileSync(png, PNG_1X1);
    writeFileSync(junk, "not media");
    await importPaths(page, [CLIP_MP4, png, junk]);
    await expect(page.getByTestId("import-summary").last()).toHaveText(
      "2 imported · 1 could not be imported",
    );
    await expect(page.getByTestId("media-card")).toHaveCount(2);

    const library = await items(page);
    const video = library.find((item) => item.mediaType === "video")!;
    const image = library.find((item) => item.mediaType === "image")!;
    expect(image).toMatchObject({
      name: "flyer.png",
      category: "image",
      fileSize: PNG_1X1.byteLength,
    });
    if (video.hasThumbnail) {
      // ffmpeg available: probed metadata and a poster over cmp-media://thumb.
      expect(video).toMatchObject({ width: 640, height: 360, codec: "h264" });
      const poster = page.locator(`img[src="cmp-media://thumb/${video.id}"]`);
      await expect
        .poll(() =>
          poster.evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBeGreaterThan(0);
    }

    // Duplicate → "Already in library", no second asset.
    await importPaths(page, [png]);
    await expect(page.getByTestId("import-summary").last()).toHaveText(
      "1 already in library",
    );
    await expect(page.getByTestId("media-card")).toHaveCount(2);

    // Hover preview plays the video.
    const videoCard = page
      .getByTestId("media-card")
      .filter({ hasText: "clip.mp4" });
    await videoCard.hover();
    const preview = page.getByTestId("hover-preview");
    await expect
      .poll(() => preview.evaluate((v: HTMLVideoElement) => v.currentTime), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0.2);

    // Search.
    await page.getByLabel("Search media").fill("flyer");
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await page.getByLabel("Search media").fill("");
    await expect(page.getByTestId("media-card")).toHaveCount(2);

    // Organise: tags and favourite from the detail panel.
    await page
      .getByTestId("media-card")
      .filter({ hasText: "flyer.png" })
      .click();
    const detail = page.getByTestId("media-detail");
    await detail.getByLabel("Tags (comma separated)").fill("easter, harvest");
    await detail.getByLabel("Tags (comma separated)").press("Enter");
    const filters = page.getByRole("complementary", {
      name: "Library filters",
    });
    await expect(filters.getByRole("button", { name: /easter/ })).toBeVisible();
    await filters.getByRole("button", { name: /easter/ }).click();
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await filters.getByRole("button", { name: /easter/ }).click();
    await page
      .getByRole("button", { name: "Favourite flyer.png" })
      .click({ force: true });
    await filters.getByRole("button", { name: "Favourites" }).click();
    await expect(page.getByTestId("media-card")).toHaveCount(1);
    await filters.getByRole("button", { name: "Favourites" }).click();

    // The same image becomes the church logo → delete is blocked with usedBy.
    await stubOpenDialog(app, png);
    await page.evaluate(() => window.cmp.workspace.chooseLogo());
    await page
      .getByTestId("media-card")
      .filter({ hasText: "flyer.png" })
      .click();
    await detail.getByRole("button", { name: "Delete" }).click();
    await detail
      .getByRole("button", { name: "Delete", exact: true })
      .last()
      .click();
    await expect(detail.getByRole("alert")).toContainText(
      "still used by Church logo",
    );
    await expect(page.getByTestId("media-card")).toHaveCount(2);

    // Missing-file scan: remove the video from disk, then "Check files".
    const workspaceDir = join(
      userData.dir,
      "workspaces",
      readdirSync(join(userData.dir, "workspaces"))[0]!,
    );
    const shard = readdirSync(join(workspaceDir, "media")).find((dir) =>
      readdirSync(join(workspaceDir, "media", dir)).some((file) =>
        file.endsWith(".mp4"),
      ),
    )!;
    for (const file of readdirSync(join(workspaceDir, "media", shard))) {
      if (file.endsWith(".mp4"))
        rmSync(join(workspaceDir, "media", shard, file));
    }
    await page.getByRole("button", { name: "Check files" }).click();
    await expect(videoCard.getByTestId("missing-badge")).toBeVisible();

    // An unused asset deletes.
    await videoCard.click();
    await detail.getByRole("button", { name: "Delete" }).click();
    await detail
      .getByRole("button", { name: "Delete", exact: true })
      .last()
      .click();
    await expect(page.getByTestId("media-card")).toHaveCount(1);

    // List view.
    await page.getByRole("button", { name: "list view" }).click();
    await expect(page.getByTestId("media-row")).toHaveCount(1);

    expect(
      consoleErrors.filter((error) => !error.includes("cmp-media://asset")),
    ).toEqual([]);
  } finally {
    await app.close();
    userData.cleanup();
  }
});
