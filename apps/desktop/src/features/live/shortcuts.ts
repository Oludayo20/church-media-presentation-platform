import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
} from "@cmp/shared-validation";

export type Bindings = Record<ShortcutAction, string[]>;

const isMac = () =>
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** `KeyboardEvent` → `[Mod+][Alt+][Shift+]<key>` (see shared shortcuts.ts). */
export function comboFromEvent(event: KeyboardEvent): string | null {
  const key = normaliseKey(event.key);
  if (!key) return null;
  const mod = isMac() ? event.metaKey : event.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  // Shift only matters for non-character keys ("?" already implies shift).
  if (event.shiftKey && key.length > 1) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

function normaliseKey(key: string): string | null {
  if (
    [
      "Shift",
      "Control",
      "Alt",
      "Meta",
      "CapsLock",
      "Dead",
      "Unidentified",
    ].includes(key)
  ) {
    return null;
  }
  if (key === " ") return "Space";
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Shortcuts never fire while typing or inside a dialog (§3.5). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.isContentEditable ||
    target.closest('[contenteditable="true"], [contenteditable=""]')
  ) {
    return true;
  }
  if (target.closest('[role="dialog"], dialog[open]')) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return ![
      "button",
      "checkbox",
      "radio",
      "range",
      "submit",
      "reset",
    ].includes(type);
  }
  return false;
}

export function actionFor(
  bindings: Bindings,
  combo: string,
): ShortcutAction | null {
  for (const action of Object.keys(SHORTCUT_ACTIONS) as ShortcutAction[]) {
    if ((bindings[action] ?? DEFAULT_SHORTCUTS[action]).includes(combo))
      return action;
  }
  return null;
}

/** Assigns `combo` to `action`, removing it from any other action. */
export function rebind(
  bindings: Bindings,
  action: ShortcutAction,
  combo: string,
): Bindings {
  const next = Object.fromEntries(
    Object.entries(bindings).map(([name, combos]) => [
      name,
      combos.filter((existing) => existing !== combo),
    ]),
  ) as Bindings;
  next[action] = [...next[action], combo].slice(-4);
  return next;
}

/** Human label: `Mod+f` → `⌘F` / `Ctrl+F`, `ArrowRight` → `→`. */
export function formatCombo(combo: string): string {
  const names: Record<string, string> = {
    ArrowRight: "→",
    ArrowLeft: "←",
    ArrowUp: "↑",
    ArrowDown: "↓",
    PageDown: "Page Down",
    PageUp: "Page Up",
    Escape: "Esc",
    Space: "Space",
  };
  return combo
    .split("+")
    .map((part, index, parts) => {
      if (index < parts.length - 1) {
        if (part === "Mod") return isMac() ? "⌘" : "Ctrl+";
        if (part === "Alt") return isMac() ? "⌥" : "Alt+";
        if (part === "Shift") return isMac() ? "⇧" : "Shift+";
      }
      return names[part] ?? (part.length === 1 ? part.toUpperCase() : part);
    })
    .join("");
}
