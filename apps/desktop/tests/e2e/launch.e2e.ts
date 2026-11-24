import { expect, test } from "@playwright/test";
import { launchApp, tempUserData, type LaunchedApp } from "./fixtures";

let launched: LaunchedApp;
const userData = tempUserData();

test.beforeAll(async () => {
  launched = await launchApp(userData.dir);
});

test.afterAll(async () => {
  await launched?.app.close();
  userData.cleanup();
});

test("opens the operator window on first-launch onboarding", async () => {
  const { page } = launched;
  await expect(page).toHaveTitle("Church Media");
  await expect(
    page.getByRole("heading", { name: "What is your church called?" }),
  ).toBeVisible();
});

test("round-trips app:info over the typed preload bridge", async () => {
  const { app, page } = launched;
  const electronVersion = await app.evaluate(() => process.versions.electron);
  const result = await page.evaluate(() => window.cmp.app.info());
  expect(result).toMatchObject({
    success: true,
    data: { electron: electronVersion },
  });
});

test("renderer is sandboxed with only the cmp bridge exposed", async () => {
  const exposure = await launched.page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    cmpKeys: Object.keys(window.cmp).sort(),
    settingsMethods: Object.keys(window.cmp.settings).sort(),
    liveEvents: Object.keys(window.cmp.live).filter((key) =>
      key.startsWith("on"),
    ),
  }));
  expect(exposure).toEqual({
    require: "undefined",
    process: "undefined",
    cmpKeys: [
      "app",
      "bible",
      "displays",
      "files",
      "fonts",
      "jobs",
      "live",
      "media",
      "presentations",
      "settings",
      "songs",
      "workspace",
    ],
    settingsMethods: ["get", "set"],
    liveEvents: ["onState"],
  });
});

test("IPC rejects invalid payloads with VALIDATION_ERROR", async () => {
  const result = await launched.page.evaluate(() =>
    (
      window.cmp.workspace.create as unknown as (
        input: unknown,
      ) => Promise<unknown>
    )({ churchName: 42, path: "/etc/passwd" }),
  );
  expect(result).toMatchObject({
    success: false,
    error: { code: "VALIDATION_ERROR" },
  });
});

test("settings channels answer NOT_FOUND before a workspace exists", async () => {
  const result = await launched.page.evaluate(() => window.cmp.settings.get());
  expect(result).toMatchObject({
    success: false,
    error: { code: "NOT_FOUND" },
  });
});

test("window.open is denied", async () => {
  const { app, page } = launched;
  const before = app.windows().length;
  await page.evaluate(() => window.open("https://example.com"));
  expect(app.windows().length).toBe(before);
});

test("navigation away from the app bundle is blocked", async () => {
  const { page } = launched;
  const url = page.url();
  await page.evaluate(() => {
    window.location.href = "https://example.com";
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(url);
});

test("strict CSP is in place and nothing violated it", async () => {
  const { page, consoleErrors } = launched;
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(
    consoleErrors.filter((text) => text.includes("Content Security Policy")),
  ).toEqual([]);
});
