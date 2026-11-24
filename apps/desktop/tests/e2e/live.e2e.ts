import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  CLIP_MP4,
  DEMO_BIBLE,
  completeOnboarding,
  launchApp,
  stubOpenDialog,
  tempUserData,
} from "./fixtures";

/**
 * Phases 2–3 end to end, with a simulated projector (`CMP_FAKE_DISPLAYS=1`):
 * fake displays are windows carved out of the real primary screen, plugged
 * and unplugged through `globalThis.__cmpTest.screen` in the main process.
 */

const PROJECTOR = {
  label: "E2E Projector",
  bounds: { x: 40, y: 40, width: 640, height: 360 },
};

async function plugProjector(
  app: ElectronApplication,
  id: number,
): Promise<void> {
  await app.evaluate(
    (_electron, { id, display }) => {
      const hooks = (
        globalThis as unknown as {
          __cmpTest: { screen: { add(d: unknown): void } };
        }
      ).__cmpTest;
      hooks.screen.add({ id, ...display });
    },
    { id, display: PROJECTOR },
  );
}

async function unplugProjector(
  app: ElectronApplication,
  id: number,
): Promise<void> {
  await app.evaluate((_electron, id) => {
    const hooks = (
      globalThis as unknown as {
        __cmpTest: { screen: { remove(id: number): void } };
      }
    ).__cmpTest;
    hooks.screen.remove(id);
  }, id);
}

/** The audience window, once it exists. */
async function audiencePage(app: ElectronApplication): Promise<Page> {
  await expect
    .poll(
      () =>
        app
          .windows()
          .filter(
            (w) =>
              w.url().includes("audience.html") &&
              !w.url().includes("identify"),
          ).length,
    )
    .toBe(1);
  return app
    .windows()
    .find(
      (w) => w.url().includes("audience.html") && !w.url().includes("identify"),
    )!;
}

async function audienceWindowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter(
        (w) =>
          !w.isDestroyed() &&
          w.webContents.getURL().includes("audience.html") &&
          !w.webContents.getURL().includes("identify"),
      ).length,
  );
}

/** The slide the engine in `page` has on screen (top deck). */
async function shownSlide(page: Page, scope = "body"): Promise<string | null> {
  return page.evaluate((scope) => {
    const decks = document.querySelectorAll<HTMLElement>(
      `${scope} [data-cmp-deck]`,
    );
    const top = decks[decks.length - 1];
    return top?.dataset["cmpSlideId"] ?? null;
  }, scope);
}

const MIRROR = "[data-testid=audience-mirror]";

/**
 * Real layout check (jsdom cannot do this): the visible text is actually on
 * top, not hidden under a background layer.
 */
async function textIsOnTop(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const decks = document.querySelectorAll<HTMLElement>("[data-cmp-deck]");
    const deck = decks[decks.length - 1];
    const layer = [
      ...(deck?.querySelectorAll<HTMLElement>(
        '[data-cmp-plane="content"] > [data-cmp-layer]',
      ) ?? []),
    ].find((candidate) => candidate.style.visibility === "visible");
    const text = layer?.querySelector<HTMLElement>("[data-cmp-role] > div");
    if (!text) return false;
    const box = text.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return !!hit && text.contains(hit);
  });
}

async function liveState(page: Page) {
  return page.evaluate(async () => {
    const result = await window.cmp.live.getState();
    if (!result.success) throw new Error(result.error.message);
    return result.data;
  });
}

async function expectedSlideId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const state = await window.cmp.live.getState();
    if (!state.success) throw new Error("no state");
    const { itemIndex, slideIndex } = state.data;
    const doc = await window.cmp.live.document({ itemIndex });
    if (!doc.success) throw new Error("no doc");
    return doc.data.slides[slideIndex]!.id;
  });
}

test("Phase 3: advance 20 slides, unplug the projector, replug it, same slide is shown", async () => {
  const userData = tempUserData();
  const { app, page, consoleErrors } = await launchApp(userData.dir, {
    fakeDisplays: true,
  });
  try {
    await completeOnboarding(page);
    await page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("button", { name: "Live" })
      .click();

    // A projector is plugged in: the operator is offered it, and accepts.
    await plugProjector(app, 9001);
    const toast = page.getByTestId("new-display-toast");
    await expect(toast).toContainText("E2E Projector");
    await toast.getByRole("button", { name: "Use as audience screen" }).click();
    await expect(page.getByTestId("display-9001")).toContainText("Audience");

    await page.getByRole("button", { name: "Go live", exact: true }).click();
    await expect(page.getByTestId("live-status")).toHaveAttribute(
      "data-status",
      "live",
    );
    const audience = await audiencePage(app);
    await expect.poll(() => shownSlide(audience)).toBe("welcome-1");

    // Twenty presses of the clicker's "next" (PageDown) and the arrow key.
    for (let press = 0; press < 20; press += 1) {
      await page.keyboard.press(press % 2 === 0 ? "PageDown" : "ArrowRight");
    }
    await expect
      .poll(async () => (await liveState(page)).items.length)
      .toBeGreaterThan(0);
    const expected = await expectedSlideId(page);
    await expect.poll(() => shownSlide(audience)).toBe(expected);
    await expect.poll(() => shownSlide(page, MIRROR)).toBe(expected); // operator mirror agrees
    await expect.poll(() => textIsOnTop(audience)).toBe(true);

    // ── Unplug ──
    await unplugProjector(app, 9001);
    await expect(page.getByTestId("disconnected-banner")).toBeVisible();
    await expect(page.getByTestId("live-status")).toHaveAttribute(
      "data-status",
      "suspended",
    );
    await expect.poll(() => audienceWindowCount(app)).toBe(0);
    // The operator still sees the picture.
    expect(await shownSlide(page, MIRROR)).toBe(expected);

    // ── Replug: the OS gives it a new id; the fingerprint matches ──
    await plugProjector(app, 9002);
    await expect(page.getByTestId("disconnected-banner")).toBeHidden();
    await expect(page.getByTestId("live-status")).toHaveAttribute(
      "data-status",
      "live",
    );
    const restored = await audiencePage(app);
    await expect.poll(() => shownSlide(restored)).toBe(expected);
    await expect.poll(() => textIsOnTop(restored)).toBe(true);
    await expect(page.getByTestId("new-display-toast")).toBeHidden();

    // The journal recorded where we are.
    const state = await liveState(page);
    expect(state).toMatchObject({ output: "display", status: "live" });

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
    userData.cleanup();
  }
});

test("Phase 2: 1080p-path video plays on the audience output; BLACK, LOGO, overlays and test pattern", async () => {
  const userData = tempUserData();
  const { app, page } = await launchApp(userData.dir, { fakeDisplays: true });
  try {
    await completeOnboarding(page, "Grace Chapel");
    await page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("button", { name: "Bible" })
      .click();
    await stubOpenDialog(app, DEMO_BIBLE);
    await page.getByRole("button", { name: "Install translation" }).click();
    await expect(
      page.getByRole("combobox", { name: "Bible translation" }),
    ).toHaveValue("DEMO");
    await page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("button", { name: "Live" })
      .click();
    await plugProjector(app, 9101);
    await page
      .getByTestId("new-display-toast")
      .getByRole("button", { name: "Use as audience screen" })
      .click();

    // Test pattern opens the audience window outside a session, with the safe area.
    await page.getByRole("button", { name: "Test pattern" }).click();
    let audience = await audiencePage(app);
    await expect(audience.locator("[data-cmp-safe-area='5']")).toBeVisible();
    await page.getByRole("button", { name: "Hide test pattern" }).click();
    await expect.poll(() => audienceWindowCount(app)).toBe(0);

    // Add a real video to the test deck through the (stubbed) native dialog.
    await stubOpenDialog(app, CLIP_MP4);
    await page.getByRole("button", { name: "Add test media" }).click();
    await expect(
      page.getByRole("button", { name: "Add test media" }),
    ).toBeEnabled();
    await expect(page.getByText("Added to the test deck")).toBeVisible();

    await page.getByRole("button", { name: "Go live", exact: true }).click();
    audience = await audiencePage(app);
    await expect.poll(() => shownSlide(audience)).toBe("welcome-1");

    // Jump to the "Test media" item: the video must actually advance.
    const state = await liveState(page);
    const mediaIndex = state.items.findIndex((item) => item.kind === "media");
    await page
      .getByRole("navigation", { name: "Playlist" })
      .getByRole("button", { name: /Test media/ })
      .first()
      .click();
    await expect
      .poll(async () => (await liveState(page)).itemIndex)
      .toBe(mediaIndex);
    const videoTime = () =>
      audience.evaluate(
        () =>
          document.querySelector<HTMLVideoElement>(
            'video[data-cmp-media="foreground"]',
          )?.currentTime ?? 0,
      );
    await expect.poll(videoTime, { timeout: 10_000 }).toBeGreaterThan(0.5);
    // Sound is on for the audience, off for the operator mirror.
    expect(
      await audience.evaluate(() => document.querySelector("video")!.muted),
    ).toBe(false);
    expect(
      await page.evaluate(
        () =>
          document.querySelector<HTMLVideoElement>(
            "[data-testid=audience-mirror] video",
          )?.muted ?? true,
      ),
    ).toBe(true);
    await expect(page.getByTestId("transport")).toBeVisible();

    // BLACK by keyboard, LOGO by button.
    await page.keyboard.press("b");
    await expect(audience.locator("[data-cmp-mask]")).toHaveAttribute(
      "data-cmp-mask",
      "black",
    );
    await page.getByRole("button", { name: "Logo" }).click();
    await expect(audience.locator("[data-cmp-mask]")).toHaveAttribute(
      "data-cmp-mask",
      "logo",
    );
    await expect(audience.locator("[data-cmp-mask]")).toContainText(
      "Grace Chapel",
    );
    await page.getByRole("button", { name: "Logo" }).click();
    await expect(audience.locator("[data-cmp-mask]")).toHaveAttribute(
      "data-cmp-mask",
      "none",
    );

    // Overlay a reading over the playing video, then Esc returns to it.
    const before = await videoTime();
    await page
      .getByRole("button", { name: "Overlay Sample Reading" })
      .click({ force: true });
    await expect(page.getByTestId("live-status")).toHaveAttribute(
      "data-status",
      "overlay",
    );
    await expect.poll(() => shownSlide(audience)).toBe("sample-reading-1");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => shownSlide(audience)).toBe("sample-reading-2");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-status")).toHaveAttribute(
      "data-status",
      "live",
    );
    await expect.poll(() => shownSlide(audience)).toMatch(/^media-/);
    expect(await videoTime()).toBeGreaterThanOrEqual(before);

    // Quick Scripture previews first and restores the playing video on Escape.
    const beforeScripture = await videoTime();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+f" : "Control+f",
    );
    const scripture = page.getByRole("dialog", { name: "Quick Scripture" });
    const scriptureInput = scripture.getByRole("textbox", {
      name: "Scripture reference or search terms",
    });
    await expect(scriptureInput).toBeFocused();
    await scriptureInput.fill("Jn 3:16");
    await scriptureInput.press("Enter");
    await expect(
      scripture.getByText("A demonstration passage", { exact: false }),
    ).toBeVisible();
    await expect.poll(() => shownSlide(audience)).toMatch(/^media-/);
    await scriptureInput.press("Enter");
    await expect.poll(() => shownSlide(audience)).toBe("scripture-1");
    await scriptureInput.press("Escape");
    await expect(scripture).toHaveCount(0);
    await expect.poll(() => shownSlide(audience)).toMatch(/^media-/);
    expect(await videoTime()).toBeGreaterThanOrEqual(beforeScripture);

    // Esc with no overlay asks before ending.
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").getByRole("button", { name: "End" }).click();
    await expect.poll(() => audienceWindowCount(app)).toBe(0);
  } finally {
    await app.close();
    userData.cleanup();
  }
});

test("single display: going live runs in preview mode inside the app", async () => {
  const userData = tempUserData();
  const { app, page } = await launchApp(userData.dir, { fakeDisplays: true });
  try {
    await completeOnboarding(page);
    await page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("button", { name: "Live" })
      .click();
    await expect(
      page.getByText("No projector or second screen is connected"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Go live (preview only)" }).click();
    await expect(page.getByTestId("display-chip")).toContainText(
      "Preview only",
    );
    await expect.poll(() => shownSlide(page, MIRROR)).toBe("welcome-1");
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await liveState(page)).itemIndex).toBe(1);
    expect(await audienceWindowCount(app)).toBe(0);
    // Slide numbers: "3" then Enter.
    await page.keyboard.press("3");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await liveState(page)).slideIndex).toBe(2);
  } finally {
    await app.close();
    userData.cleanup();
  }
});
