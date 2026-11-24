import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, launchApp, tempUserData } from "./fixtures";

/** Phase 5 end to end. All lyrics are invented placeholders. */

const LYRICS = `Verse 1
Morning light is breaking
Over hills of green

Chorus
Sing a new song
Lift your voices high

Verse 2
Evening stars are shining
Over sleeping towns

Chorus`;

async function mirrorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const decks = document.querySelectorAll<HTMLElement>(
      "[data-testid=audience-mirror] [data-cmp-deck]",
    );
    const deck = decks[decks.length - 1];
    const layer = [
      ...(deck?.querySelectorAll<HTMLElement>(
        '[data-cmp-plane="content"] > [data-cmp-layer]',
      ) ?? []),
    ].find((candidate) => candidate.style.visibility === "visible");
    return (
      layer?.querySelector<HTMLElement>('[data-cmp-object="lyrics"]')
        ?.textContent ?? ""
    );
  });
}

test("Phase 5: write, import and search songs, then fix a lyric live", async () => {
  const userData = tempUserData();
  const { page, app, consoleErrors } = await launchApp(userData.dir);
  try {
    await completeOnboarding(page);
    const nav = page.getByRole("navigation", { name: "Modules" });
    await nav.getByRole("button", { name: "Songs" }).click();
    await expect(page.getByText("Choose a song or create one")).toBeVisible();

    // ── Create by pasting lyrics ──
    await page.getByRole("button", { name: "New song" }).click();
    await page.getByLabel("Song title").fill("Sunrise Anthem");
    await page.getByRole("button", { name: "Paste lyrics" }).click();
    await page.getByLabel("Lyrics to paste").fill(LYRICS);
    await page.getByRole("button", { name: "Use these lyrics" }).click();
    await expect(page.getByTestId("song-section")).toHaveCount(3);
    await expect(page.getByTestId("arrangement-chip")).toHaveText([
      "V1",
      "C",
      "V2",
      "C",
    ]);
    // Preview: 2 lines per slide → one slide per section occurrence, grouped.
    await expect(page.getByTestId("song-slide")).toHaveCount(4);
    await expect(
      page.getByRole("region", { name: "Chorus" }).first(),
    ).toBeVisible();

    await page
      .getByRole("group", { name: "Collections", exact: true })
      .getByRole("button", { name: "Hymns" })
      .click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("main", { name: "Song editor" }).getByRole("status"),
    ).toContainText("Saved");
    await expect(page.getByTestId("song-item")).toHaveCount(1);

    // ── Import a Yoruba song file ──
    const file = join(userData.dir, "Ọlọ́run Ńlá.txt");
    writeFileSync(
      file,
      "Ọlọ́run Ńlá\n\nVerse 1\nỌlọ́run mi, ìwọ ni mo yìn\n\nChorus\nOlúwa ṣeun",
    );
    const imported = await page.evaluate(
      (paths) => window.cmp.songs.import({ paths }),
      [file],
    );
    expect(imported).toMatchObject({
      success: true,
      data: { imported: [{ title: "Ọlọ́run Ńlá" }], failed: [] },
    });

    // ── Search: diacritics-insensitive, lyric snippets, collections ──
    const search = page.getByLabel("Search songs");
    await search.fill("olorun");
    await expect(page.getByTestId("song-item")).toHaveText([/Ọlọ́run Ńlá/]);
    await search.fill("evening stars");
    await expect(page.getByTestId("song-item")).toHaveCount(1);
    await expect(page.getByTestId("song-snippet")).toContainText("«Evening»");
    await search.fill("");
    await page
      .getByRole("group", { name: "Collections filter" })
      .getByRole("button", { name: "Hymns" })
      .click();
    await expect(page.getByTestId("song-item")).toHaveText([/Sunrise Anthem/]);

    // ── Live: add the song, jump to the chorus, fix a lyric ──
    await nav.getByRole("button", { name: "Live" }).click();
    await page.getByRole("button", { name: "Go live (preview only)" }).click();
    await page.getByLabel("Find a song to add").fill("sunrise");
    await page
      .getByRole("list", { name: "Song results" })
      .getByRole("button", { name: /Sunrise Anthem/ })
      .click();
    const playlist = page.getByRole("navigation", { name: "Playlist" });
    await playlist
      .getByRole("button", { name: /Sunrise Anthem/ })
      .first()
      .click();
    await page
      .getByRole("region", { name: "Slides" })
      .getByRole("button", { name: "Slide 2" })
      .click();
    await expect
      .poll(() => mirrorText(page))
      .toBe("Sing a new song\nLift your voices high");

    await page.getByRole("button", { name: "Edit lyrics" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Chorus lyrics")
      .fill("Sing a brand new song\nLift your voices high");
    await page.getByRole("button", { name: "Save to screen" }).click();
    await expect
      .poll(() => mirrorText(page))
      .toBe("Sing a brand new song\nLift your voices high");
    // Patched in place: still on the same slide, both chorus slides updated.
    const state = await page.evaluate(async () => {
      const result = await window.cmp.live.getState();
      return result.success ? result.data : null;
    });
    expect(state).toMatchObject({ slideIndex: 1 });
    const doc = await page.evaluate(async (itemIndex) => {
      const result = await window.cmp.live.document({ itemIndex });
      return result.success
        ? result.data.slides.map(
            (slide) => (slide.objects[0] as { content?: string }).content,
          )
        : [];
    }, state!.itemIndex);
    expect(
      doc.filter((content) => content?.startsWith("Sing a brand new song")),
    ).toHaveLength(2);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
    userData.cleanup();
  }
});
