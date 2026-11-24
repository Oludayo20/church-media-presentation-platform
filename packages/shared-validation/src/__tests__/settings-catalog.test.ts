import { describe, expect, it } from "vitest";
import {
  SETTING_KEYS,
  settingsCatalog,
  settingsSchema,
  settingUpdateSchema,
} from "../settings-catalog";

describe("settings catalogue", () => {
  it("every default satisfies its own schema", () => {
    for (const key of SETTING_KEYS) {
      const { schema, default: value } = settingsCatalog[key];
      expect(schema.safeParse(value).success, key).toBe(true);
    }
  });

  it("matches the documented §13 defaults", () => {
    const defaults = Object.fromEntries(
      SETTING_KEYS.map((key) => [key, settingsCatalog[key].default]),
    );
    expect(defaults).toMatchObject({
      "display.outputResolution": { w: 1920, h: 1080 },
      "display.safeAreaPct": 5,
      "live.fallbackBackground": { type: "color", value: "#000" },
      "live.defaultTransition": { type: "fade", ms: 300 },
      "songs.split": { mode: "lines", linesPerSlide: 2 },
      "backup.schedule": { everyDays: 7, keep: 4 },
      "ui.theme": "dark",
      "updates.channel": "stable",
    });
    expect(settingsSchema.safeParse(defaults).success).toBe(true);
  });
});

describe("settingUpdateSchema", () => {
  it("validates the value against the schema of its key", () => {
    expect(
      settingUpdateSchema.safeParse({ key: "ui.theme", value: "light" })
        .success,
    ).toBe(true);
    expect(
      settingUpdateSchema.safeParse({ key: "ui.theme", value: "purple" })
        .success,
    ).toBe(false);
    expect(
      settingUpdateSchema.safeParse({
        key: "display.outputResolution",
        value: { w: 1280, h: 720 },
      }).success,
    ).toBe(true);
    expect(
      settingUpdateSchema.safeParse({
        key: "display.outputResolution",
        value: { w: 1.5, h: 720 },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(
      settingUpdateSchema.safeParse({ key: "evil.key", value: 1 }).success,
    ).toBe(false);
  });
});
