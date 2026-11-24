import { MonitorUp, X } from "lucide-react";
import { Button } from "@cmp/design-system";
import { act, useLiveStore } from "../live-store";

/**
 * App-wide notices: "New display detected" (DOCUMENTATION.md §4.3) and the
 * last failed live action.
 */
export function LiveToasts() {
  const displays = useLiveStore((state) => state.displays);
  const error = useLiveStore((state) => state.error);
  const dismissError = useLiveStore((state) => state.dismissError);
  const newDisplay = displays?.displays.find(
    (display) => display.id === displays.newDisplayId,
  );

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-96 flex-col gap-2">
      {newDisplay && (
        <div
          role="status"
          data-testid="new-display-toast"
          className="pointer-events-auto rounded-lg border border-border bg-surface-raised p-4 shadow-xl"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <MonitorUp className="size-4 text-primary" aria-hidden />
            New display detected
          </p>
          <p className="mt-1 text-sm text-muted">
            Use “{newDisplay.label}” ({newDisplay.width}×{newDisplay.height}) as
            the audience screen?
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => act(() => window.cmp.displays.dismissNew())}
            >
              Not now
            </Button>
            <Button
              size="sm"
              onClick={() =>
                act(() =>
                  window.cmp.displays.assign({ displayId: newDisplay.id }),
                )
              }
            >
              Use as audience screen
            </Button>
          </div>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="pointer-events-auto flex items-start gap-2 rounded-lg border border-live/40 bg-surface-raised p-3 text-sm shadow-xl"
        >
          <span className="flex-1">{error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismissError}
            className="text-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
