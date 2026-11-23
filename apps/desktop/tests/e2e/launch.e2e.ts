import { resolve } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  app = await electron.launch({ args: [resolve(__dirname, "../..")] });
  page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
});

test("opens the operator window", async () => {
  await expect(page).toHaveTitle("Church Media");
  await expect(
    page.getByRole("heading", { name: "Church Media" }),
  ).toBeVisible();
});

test("round-trips app:info over the typed preload bridge", async () => {
  const electronVersion = await app.evaluate(() => process.versions.electron);
  await expect(page.getByTestId("electron-version")).toHaveText(
    electronVersion,
  );
});

test("renderer is sandboxed with only the cmp bridge exposed", async () => {
  const exposure = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    cmpKeys: Object.keys(window.cmp),
  }));
  expect(exposure).toEqual({
    require: "undefined",
    process: "undefined",
    cmpKeys: ["app"],
  });
});

test("window.open is denied", async () => {
  const before = app.windows().length;
  await page.evaluate(() => window.open("https://example.com"));
  expect(app.windows().length).toBe(before);
});

test("navigation away from the app bundle is blocked", async () => {
  const url = page.url();
  await page.evaluate(() => {
    window.location.href = "https://example.com";
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(url);
});

test("strict CSP is in place and nothing violated it", async () => {
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(
    consoleErrors.filter((text) => text.includes("Content Security Policy")),
  ).toEqual([]);
});
