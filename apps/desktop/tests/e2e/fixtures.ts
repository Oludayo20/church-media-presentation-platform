import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

/** 1×1 PNG used as a church logo. */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  consoleErrors: string[];
}

/** A throwaway userData directory so every test starts clean. */
export function tempUserData(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "cmp-e2e-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const DEMO_BIBLE = resolve(
  __dirname,
  "../../../../packages/import-export/src/bible/__tests__/fixtures/demo.cmpbible",
);

export const CLIP_MP4 = resolve(__dirname, "fixtures/clip.mp4");

export async function launchApp(
  userDataDir: string,
  options: { fakeDisplays?: boolean } = {},
): Promise<LaunchedApp> {
  // Editors built on Electron (VS Code) export ELECTRON_RUN_AS_NODE to child
  // processes, which would start the app as plain Node.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const app = await electron.launch({
    args: [resolve(__dirname, "../..")],
    env: {
      ...env,
      CMP_USER_DATA_DIR: userDataDir,
      ...(options.fakeDisplays ? { CMP_FAKE_DISPLAYS: "1" } : {}),
    },
  });
  const page = await app.firstWindow();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.waitForLoadState("domcontentloaded");
  return { app, page, consoleErrors };
}

/** Makes the next native "open file" dialog return `filePath`. */
export async function stubOpenDialog(
  app: ElectronApplication,
  filePath: string,
): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog;
  }, filePath);
}

export function writeLogo(dir: string): string {
  const path = join(dir, "logo.png");
  writeFileSync(path, PNG_1X1);
  return path;
}

/** Completes onboarding through the UI. */
export async function completeOnboarding(
  page: Page,
  churchName = "Grace Chapel",
): Promise<void> {
  await page.getByLabel("Church name").fill(churchName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByTestId("church-name").waitFor();
}
