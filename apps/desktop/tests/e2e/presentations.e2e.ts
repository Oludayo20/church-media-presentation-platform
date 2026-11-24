import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  completeOnboarding,
  DEMO_BIBLE,
  launchApp,
  stubOpenDialog,
  tempUserData,
} from "./fixtures";

test("copy scripture to a presentation, edit it, save and restore the original", async () => {
  const userData = tempUserData();
  const { app, page } = await launchApp(userData.dir);
  try {
    await completeOnboarding(page);
    await page.getByRole("button", { name: "Bible", exact: true }).click();
    await stubOpenDialog(app, DEMO_BIBLE);
    await page.getByRole("button", { name: "Install translation" }).click();
    await expect(
      page.getByRole("combobox", { name: "Bible translation" }),
    ).toHaveValue("DEMO");
    const query = page.getByRole("textbox", {
      name: "Scripture reference or search terms",
    });
    await query.fill("demonstration");
    await expect(page.locator("mark")).toHaveText("demonstration");
    await page
      .getByRole("button", { name: /John 3:16.*demonstration/ })
      .click();
    await page.getByRole("button", { name: "Copy to presentation" }).click();
    const title = page.getByRole("textbox", { name: "Presentation title" });
    await expect(title).toHaveValue("John 3:16");
    await title.fill("Sunday reading");
    await page.getByRole("button", { name: "4:3", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved version 2" }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Version to restore" })
      .selectOption("1");
    await page.getByRole("button", { name: "Restore version" }).click();
    await expect(title).toHaveValue("John 3:16");
    await expect(page.getByLabel("Canvas width")).toHaveValue("1920");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await page.getByRole("button", { name: "John 3:16" }).click();
    await expect(title).toHaveValue("John 3:16");

    await page.getByRole("textbox", { name: "Template name" }).fill("Reading");
    await page.getByRole("button", { name: "Save as template" }).click();
    await expect(
      page.getByText("Template saved", { exact: true }),
    ).toBeVisible();
    const file = join(userData.dir, "reading.cmppres");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath,
      })) as typeof dialog.showSaveDialog;
    }, file);
    await page.getByRole("button", { name: "Export .cmppres" }).click();
    await expect(
      page.getByText("Presentation exported", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await expect(
      page
        .getByRole("combobox", { name: "Presentation template" })
        .getByRole("option", { name: "Reading" }),
    ).toHaveCount(1);
    await stubOpenDialog(app, file);
    await page.getByRole("button", { name: "Import .cmppres" }).click();
    await expect(title).toHaveValue("John 3:16");
    await page.getByRole("button", { name: "Back to presentations" }).click();
    await expect(page.getByRole("button", { name: "John 3:16" })).toHaveCount(
      2,
    );
  } finally {
    await app.close();
    userData.cleanup();
  }
});
