import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  completeOnboarding,
  launchApp,
  stubOpenDialog,
  tempUserData,
  writeLogo,
} from "./fixtures";

test("Journey 1: onboarding creates the workspace, and everything survives a restart", async () => {
  const userData = tempUserData();
  try {
    // ── First launch: onboarding ─────────────────────────────────────────
    let { app, page, consoleErrors } = await launchApp(userData.dir);

    await page.getByLabel("Church name").fill("   ");
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.getByLabel("Church name").fill("Grace Chapel, Ikeja");
    await page.getByRole("button", { name: "Continue" }).click();

    // Logo: the native dialog is stubbed to return a PNG.
    await expect(
      page.getByRole("heading", { name: "Add your church logo" }),
    ).toBeVisible();
    await stubOpenDialog(app, writeLogo(userData.dir));
    await page.getByRole("button", { name: "Choose logo…" }).click();
    const logo = page.getByTestId("church-logo");
    await expect(logo).toBeVisible();
    // Served over cmp-media:// and decoded by the renderer.
    await expect
      .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(1);
    await page.getByRole("button", { name: "Continue" }).click();

    // Output + theme: theme applies immediately.
    await page.getByRole("radio", { name: /720p HD/ }).click();
    await page.getByRole("radio", { name: /^Light/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Finish setup" }).click();

    // ── App shell ─────────────────────────────────────────────────────────
    await expect(page.getByTestId("church-name")).toHaveText(
      "Grace Chapel, Ikeja",
    );
    await expect(page.getByTestId("home-resolution")).toContainText(
      "1280 × 720",
    );
    const nav = page.getByRole("navigation", { name: "Modules" });
    for (const label of [
      "Home",
      "Live",
      "Services",
      "Presentations",
      "Songs",
      "Bible",
      "Media",
      "Templates",
      "Downloads",
      "Settings",
    ]) {
      await expect(nav.getByRole("button", { name: label })).toBeVisible();
    }
    await nav.getByRole("button", { name: "Bible" }).click();
    await expect(page.getByRole("heading", { name: "Bible" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Install translation" }),
    ).toBeVisible();

    // The workspace is laid out on disk as DOCUMENTATION.md §13 describes.
    const workspaces = readdirSync(join(userData.dir, "workspaces"));
    expect(workspaces).toHaveLength(1);
    const workspaceDir = join(userData.dir, "workspaces", workspaces[0]!);
    expect(existsSync(join(workspaceDir, "workspace.db"))).toBe(true);
    expect(existsSync(join(userData.dir, "logs", "main.log"))).toBe(true);

    // Move the window so we can check bounds persistence.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.setBounds({
        x: 120,
        y: 120,
        width: 1200,
        height: 800,
      });
    });
    expect(consoleErrors).toEqual([]);
    await app.close();

    // ── Second launch: straight into the shell, state restored ───────────
    ({ app, page, consoleErrors } = await launchApp(userData.dir));
    await expect(page.getByTestId("church-name")).toHaveText(
      "Grace Chapel, Ikeja",
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(
      page.getByRole("complementary").getByTestId("church-logo"),
    ).toBeVisible();
    const bounds = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getBounds(),
    );
    expect(bounds).toMatchObject({ width: 1200, height: 800 });

    // Theme switch in the sidebar persists through settings:set.
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    const theme = await page.evaluate(async () => {
      const result = await window.cmp.settings.get();
      return result.success ? result.data["ui.theme"] : null;
    });
    expect(theme).toBe("dark");
    expect(consoleErrors).toEqual([]);
    await app.close();
  } finally {
    userData.cleanup();
  }
});

test("cmp-media:// serves ranges and refuses anything but asset ids", async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launchApp(userData.dir);
    await completeOnboarding(page);
    await stubOpenDialog(app, writeLogo(userData.dir));
    await page.evaluate(() => window.cmp.workspace.chooseLogo());

    const logoId = await page.evaluate(async () => {
      const state = await window.cmp.workspace.get();
      return state.success && state.data.status !== "none"
        ? state.data.workspace.logoAssetId
        : null;
    });
    expect(logoId).not.toBeNull();

    // The renderer may only load cmp-media:// through <img>/<video>: the
    // strict CSP (connect-src 'self') blocks fetch(). So exercise the
    // protocol handler from main with net.fetch, which goes through it.
    const result = await app.evaluate(async ({ net }, id) => {
      const status = async (url: string) => {
        try {
          return (await net.fetch(url)).status;
        } catch {
          return "network-error";
        }
      };
      const ranged = await net.fetch(`cmp-media://asset/${id}`, {
        headers: { Range: "bytes=0-7" },
      });
      return {
        full: await status(`cmp-media://asset/${id}`),
        rangeStatus: ranged.status,
        rangeBytes: (await ranged.arrayBuffer()).byteLength,
        contentRange: ranged.headers.get("content-range"),
        traversal: await status("cmp-media://asset/..%2F..%2Fconfig.json"),
        notUlid: await status("cmp-media://asset/config.json"),
        unknown: await status("cmp-media://asset/01JD0000000000000000000009"),
      };
    }, logoId);

    const rendererFetch = await page.evaluate(async (id) => {
      try {
        await fetch(`cmp-media://asset/${id}`);
        return "allowed";
      } catch {
        return "blocked";
      }
    }, logoId);
    expect(rendererFetch).toBe("blocked");

    expect(result.full).toBe(200);
    expect(result.rangeStatus).toBe(206);
    expect(result.rangeBytes).toBe(8);
    expect(result.contentRange).toMatch(/^bytes 0-7\/\d+$/);
    expect(result.traversal).not.toBe(200);
    expect(result.notUlid).toBe(400);
    expect(result.unknown).toBe(404);
    await app.close();
  } finally {
    userData.cleanup();
  }
});

test("the offline indicator follows the network", async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launchApp(userData.dir);
    await completeOnboarding(page);
    const indicator = page.getByTestId("network-status");
    await expect(indicator).toHaveAttribute("data-online", "true");

    await app.context().setOffline(true);
    await expect(indicator).toHaveAttribute("data-online", "false");
    await expect(indicator).toHaveText("Offline");

    await app.context().setOffline(false);
    await expect(indicator).toHaveAttribute("data-online", "true");
    await app.close();
  } finally {
    userData.cleanup();
  }
});
