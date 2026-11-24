import { useEffect, useRef } from "react";
import type { LiveState } from "@cmp/shared-types";
import { DEFAULT_SHORTCUTS } from "@cmp/shared-validation";
import { useWorkspaceStore } from "../../app/stores/workspace-store";
import { act } from "./live-store";
import { actionFor, comboFromEvent, isTypingTarget } from "./shortcuts";

const NUMBER_TIMEOUT_MS = 2000;

/**
 * The live keyboard layer (DOCUMENTATION.md §3.5): remappable bindings from
 * `live.shortcuts`, ignored while typing or in a dialog. PageUp/PageDown
 * clickers work out of the box. Digits then Enter jumps to slide N. Space
 * plays/pauses when the video transport has focus.
 */
export function useLiveShortcuts(
  live: LiveState,
  options: { onRequestEnd(): void; onQuickScripture(): void },
): void {
  const bindings =
    useWorkspaceStore((state) => state.settings?.["live.shortcuts"]) ??
    DEFAULT_SHORTCUTS;
  const latest = useRef({ live, bindings, options });
  latest.current = { live, bindings, options };

  useEffect(() => {
    let digits = "";
    let digitTimer: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        isTypingTarget(event.target)
      )
        return;
      const { live: state, bindings: keys, options: opts } = latest.current;
      const combo = comboFromEvent(event);
      if (!combo) return;

      if (/^[0-9]$/.test(combo)) {
        digits = (digits + combo).slice(-4);
        clearTimeout(digitTimer);
        digitTimer = setTimeout(() => (digits = ""), NUMBER_TIMEOUT_MS);
        event.preventDefault();
        return;
      }
      if (combo === "Enter" && digits) {
        const slide = Number(digits) - 1;
        digits = "";
        event.preventDefault();
        if (slide >= 0) act(() => window.cmp.live.goto({ slideIndex: slide }));
        return;
      }

      const inTransport =
        event.target instanceof HTMLElement &&
        event.target.closest("[data-transport]");
      const action =
        combo === "Space" && inTransport
          ? "videoToggle"
          : actionFor(keys, combo);
      if (!action) return;
      event.preventDefault();

      switch (action) {
        case "next":
          return act(() => window.cmp.live.next());
        case "prev":
          return act(() => window.cmp.live.prev());
        case "itemNext":
          return act(() => window.cmp.live.itemNext());
        case "itemPrev":
          return act(() => window.cmp.live.itemPrev());
        case "black":
          return act(() =>
            window.cmp.live.blank({ on: state.mask !== "black" }),
          );
        case "logo":
          return act(() => window.cmp.live.logo({ on: state.mask !== "logo" }));
        case "clear":
          return act(() => window.cmp.live.clear({ on: !state.cleared }));
        case "videoToggle":
          return act(() => window.cmp.live.video({ action: "toggle" }));
        case "quickScripture":
          return opts.onQuickScripture();
        case "escape":
          if (state.overlay) return act(() => window.cmp.live.overlayPop());
          return opts.onRequestEnd();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(digitTimer);
    };
  }, []);
}
