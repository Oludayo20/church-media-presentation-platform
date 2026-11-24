import { useState } from "react";
import {
  Grid3x3,
  Monitor,
  MonitorCheck,
  MonitorX,
  Plus,
  Radio,
  ScanEye,
} from "lucide-react";
import { Button, cn } from "@cmp/design-system";
import type { DisplayStatus, LiveState } from "@cmp/shared-types";
import { unwrap } from "../../../lib/ipc";
import { act, useLiveStore } from "../live-store";

/**
 * Before going live: pick the audience display, identify screens, project a
 * test pattern, add test media (DOCUMENTATION.md §4.1).
 */
export function LiveSetup({
  live,
  displays,
}: {
  live: LiveState;
  displays: DisplayStatus;
}) {
  const external = displays.displays.filter((display) => !display.primary);
  const audience = displays.audience;
  const run = useLiveStore((state) => state.run);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0);

  const addTestMedia = async () => {
    setAdding(true);
    const before = useLiveStore.getState().error;
    await run(() => unwrap(window.cmp.live.addTestMedia()));
    if (useLiveStore.getState().error === before)
      setAdded((count) => count + 1);
    setAdding(false);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-10">
      <header>
        <h1 className="text-2xl font-semibold">Go live</h1>
        <p className="mt-1 text-sm text-muted">
          Choose the screen your congregation sees, check it, then start.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Audience display</h2>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => act(() => window.cmp.displays.identify())}
            >
              <ScanEye className="size-4" aria-hidden />
              Identify
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={live.testPattern}
              disabled={!audience?.connected}
              onClick={() =>
                act(() =>
                  window.cmp.displays.testPattern({ on: !live.testPattern }),
                )
              }
            >
              <Grid3x3 className="size-4" aria-hidden />
              {live.testPattern ? "Hide test pattern" : "Test pattern"}
            </Button>
          </div>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Displays">
          {displays.displays.map((display) => (
            <li
              key={display.id}
              data-testid={`display-${display.id}`}
              className={cn(
                "flex items-center gap-3 rounded-md border p-3",
                display.assigned
                  ? "border-primary bg-primary/10"
                  : "border-border",
              )}
            >
              {display.assigned ? (
                <MonitorCheck className="size-5 text-primary" aria-hidden />
              ) : (
                <Monitor className="size-5 text-muted" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{display.label}</p>
                <p className="text-xs text-muted">
                  {display.width} × {display.height}
                  {display.primary && " · this screen"}
                </p>
              </div>
              {display.assigned ? (
                <span className="text-xs font-medium text-primary">
                  Audience
                </span>
              ) : (
                !display.primary && (
                  <Button
                    size="sm"
                    onClick={() =>
                      act(() =>
                        window.cmp.displays.assign({ displayId: display.id }),
                      )
                    }
                  >
                    Use
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>

        {external.length === 0 && (
          <p className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning">
            <MonitorX className="mt-0.5 size-4 shrink-0" aria-hidden />
            No projector or second screen is connected. You can still go live:
            the output is shown here in the app (preview mode).
          </p>
        )}
        {audience && !audience.connected && (
          <p className="text-sm text-warning">
            {audience.name} is remembered but not connected. Plug it in and it
            will be used automatically.
          </p>
        )}
      </section>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={adding}
            onClick={() => void addTestMedia()}
          >
            <Plus className="size-4" aria-hidden />
            {adding ? "Adding…" : "Add test media"}
          </Button>
          {added > 0 && (
            <output className="text-sm text-success">
              Added to the test deck
            </output>
          )}
        </div>
        <Button
          variant="live"
          size="lg"
          disabled={live.status === "preparing" || adding}
          onClick={() => act(() => window.cmp.live.start())}
        >
          <Radio className="size-5" aria-hidden />
          {audience?.connected ? "Go live" : "Go live (preview only)"}
        </Button>
      </div>
    </div>
  );
}
