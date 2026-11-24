import { z } from "zod";

/**
 * Remappable live shortcuts (DOCUMENTATION.md §3.5), stored in the
 * `live.shortcuts` setting. A combo is `[Mod+][Alt+][Shift+]<key>` where
 * `Mod` is ⌘ on macOS and Ctrl elsewhere, and `<key>` is `KeyboardEvent.key`
 * (single characters lower-cased, " " written as `Space`).
 * "1–9 then Enter" (go to slide N) is built in and not remappable.
 */
export const SHORTCUT_ACTIONS = {
  next: "Next slide",
  prev: "Previous slide",
  itemNext: "Next service item",
  itemPrev: "Previous service item",
  black: "Toggle black screen",
  logo: "Toggle logo screen",
  clear: "Clear text (keep background)",
  videoToggle: "Play / pause video",
  quickScripture: "Quick Scripture",
  escape: "Pop overlay / exit live",
} as const;
export type ShortcutAction = keyof typeof SHORTCUT_ACTIONS;

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string[]> = {
  next: ["ArrowRight", "PageDown", "Space"],
  prev: ["ArrowLeft", "PageUp"],
  itemNext: ["ArrowDown"],
  itemPrev: ["ArrowUp"],
  black: ["b"],
  logo: ["l"],
  clear: ["c"],
  videoToggle: ["k"],
  quickScripture: ["Mod+f"],
  escape: ["Escape"],
};

const comboSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^(Mod\+)?(Alt\+)?(Shift\+)?[^+\s]+$|^(Mod\+)?(Alt\+)?(Shift\+)?\+$/);

export const shortcutsSchema = z.object(
  Object.fromEntries(
    Object.keys(SHORTCUT_ACTIONS).map((action) => [
      action,
      z.array(comboSchema).max(4),
    ]),
  ) as Record<ShortcutAction, z.ZodArray<typeof comboSchema>>,
);
