import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@cmp/design-system";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
} from "@cmp/shared-validation";
import { useWorkspaceStore } from "../../app/stores/workspace-store";
import {
  comboFromEvent,
  formatCombo,
  rebind,
  type Bindings,
} from "../live/shortcuts";

/** Remap live shortcuts (DOCUMENTATION.md §3.5). */
export function ShortcutsEditor({ bindings }: { bindings: Bindings }) {
  const setSetting = useWorkspaceStore((state) => state.setSetting);
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const save = (next: Bindings) => void setSetting("live.shortcuts", next);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const combo = comboFromEvent(event);
      if (!combo) return;
      // Esc cancels capture (unless binding the Esc action itself).
      if (combo !== "Escape" || capturing === "escape") {
        void setSetting("live.shortcuts", rebind(bindings, capturing, combo));
      }
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, bindings, setSetting]);

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border">
        {(Object.keys(SHORTCUT_ACTIONS) as ShortcutAction[]).map((action) => (
          <li key={action} className="flex items-center gap-3 py-2">
            <span className="flex-1 text-sm">{SHORTCUT_ACTIONS[action]}</span>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {bindings[action].map((combo) => (
                <span
                  key={combo}
                  className="inline-flex items-center gap-1 rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-xs"
                >
                  {formatCombo(combo)}
                  <button
                    type="button"
                    aria-label={`Remove ${formatCombo(combo)} from ${SHORTCUT_ACTIONS[action]}`}
                    onClick={() =>
                      save({
                        ...bindings,
                        [action]: bindings[action].filter((c) => c !== combo),
                      })
                    }
                    className="text-muted hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setCapturing(action)}
                className="inline-flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-xs text-muted hover:text-foreground"
              >
                {capturing === action ? (
                  "Press a key…"
                ) : (
                  <>
                    <Plus className="size-3" aria-hidden />
                    Add
                  </>
                )}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Type a slide number then Enter to jump. Clickers send Page Up / Page
          Down.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => save(DEFAULT_SHORTCUTS)}
        >
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
