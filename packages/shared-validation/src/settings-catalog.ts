import { z } from "zod";
import { DEFAULT_SHORTCUTS, shortcutsSchema } from "./shortcuts";

/**
 * The typed settings catalogue (docs/DOCUMENTATION.md §13). Each key has a
 * Zod schema and a default. The main process validates every write against
 * it, and a stored value that no longer validates falls back to its default.
 */
function setting<S extends z.ZodType>(schema: S, defaultValue: z.output<S>) {
  return { schema, default: defaultValue } as const;
}

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Hex colour");

/**
 * Lyrics split options (DOCUMENTATION.md §5.1). New fields have defaults so
 * values saved by earlier versions still parse.
 */
export const songSplitSchema = z.object({
  mode: z.enum(["lines", "chars"]),
  linesPerSlide: z.int().min(1).max(12),
  maxChars: z.int().min(20).max(600).default(120),
  blankBetweenSections: z.boolean().default(false),
});

export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Output resolutions offered in onboarding and Settings. */
export const OUTPUT_RESOLUTIONS = [
  { w: 1280, h: 720, label: "720p HD" },
  { w: 1920, h: 1080, label: "1080p Full HD" },
  { w: 3840, h: 2160, label: "4K UHD" },
  { w: 1024, h: 768, label: "1024×768 (4:3 projector)" },
] as const;

export const outputResolutionSchema = z.object({
  w: z.int().min(320).max(7680),
  h: z.int().min(240).max(4320),
});

export const settingsCatalog = {
  "display.outputResolution": setting(outputResolutionSchema, {
    w: 1920,
    h: 1080,
  }),
  "display.safeAreaPct": setting(z.number().min(0).max(20), 5),
  "live.fallbackBackground": setting(
    z.object({ type: z.literal("color"), value: hexColor }),
    { type: "color", value: "#000" },
  ),
  "live.logoAssetId": setting(z.string().nullable(), null),
  "live.shortcuts": setting(shortcutsSchema, DEFAULT_SHORTCUTS),
  "live.defaultTransition": setting(
    z.object({ type: z.enum(["cut", "fade"]), ms: z.int().min(0).max(5000) }),
    { type: "fade", ms: 300 },
  ),
  "songs.split": setting(songSplitSchema, {
    mode: "lines",
    linesPerSlide: 2,
    maxChars: 120,
    blankBetweenSections: false,
  }),
  "songs.showCopyright": setting(z.boolean(), true),
  "bible.defaultTranslation": setting(z.string().min(1).max(16), "KJV"),
  "bible.onePerSlide": setting(z.boolean(), false),
  "backup.schedule": setting(
    z.object({
      everyDays: z.int().min(1).max(90),
      keep: z.int().min(1).max(52),
    }),
    { everyDays: 7, keep: 4 },
  ),
  "ui.theme": setting(z.enum(THEMES), "dark"),
  "updates.channel": setting(z.enum(["alpha", "beta", "stable"]), "stable"),
  /** Set when first-launch onboarding finishes (DOCUMENTATION.md §17.3). */
  "onboarding.completedAt": setting(z.iso.datetime().nullable(), null),
} as const;

type Catalog = typeof settingsCatalog;
export type SettingKey = keyof Catalog;
export type Settings = { [K in SettingKey]: z.output<Catalog[K]["schema"]> };
export type SettingUpdate = {
  [K in SettingKey]: { key: K; value: Settings[K] };
}[SettingKey];

export const SETTING_KEYS = Object.keys(settingsCatalog) as SettingKey[];

/** Every setting with its value — the `settings:get` payload. */
export const settingsSchema = z.object(
  Object.fromEntries(
    SETTING_KEYS.map((key) => [key, settingsCatalog[key].schema]),
  ) as { [K in SettingKey]: Catalog[K]["schema"] },
);

/** `{ key, value }` where `value` is validated against that key's schema. */
export const settingUpdateSchema = z.discriminatedUnion(
  "key",
  SETTING_KEYS.map((key) =>
    z.object({ key: z.literal(key), value: settingsCatalog[key].schema }),
  ) as unknown as [
    z.ZodObject<{ key: z.ZodLiteral<SettingKey>; value: z.ZodType }>,
  ],
) as unknown as z.ZodType<SettingUpdate>;
