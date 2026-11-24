import { createHash } from "node:crypto";
import type { Rect } from "../windows/window-state";

/** The parts of an Electron `Display` the app uses. */
export interface DisplayLike {
  id: number;
  label: string;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
  internal: boolean;
}

export type ScreenEvent =
  "display-added" | "display-removed" | "display-metrics-changed";

/** Electron's `screen`, or a scriptable fake in e2e runs. */
export interface ScreenSource {
  getAllDisplays(): DisplayLike[];
  getPrimaryDisplay(): DisplayLike;
  on(event: ScreenEvent, listener: (display: DisplayLike) => void): void;
}

/**
 * `sha256(label|width|height|scaleFactor)` (DOCUMENTATION.md §4.1): stable
 * across replugs and OS display-id changes, distinct for different models
 * or modes. Physical pixel size is used so a scale change alone still
 * matches the same panel resolution.
 */
export function fingerprint(display: DisplayLike): string {
  const { width, height } = physicalSize(display);
  return createHash("sha256")
    .update(`${display.label}|${width}|${height}|${display.scaleFactor}`)
    .digest("hex");
}

export function physicalSize(display: DisplayLike): {
  width: number;
  height: number;
} {
  return {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
}

type Listener = (display: DisplayLike) => void;

/**
 * A fake screen for e2e tests (only with `CMP_FAKE_DISPLAYS=1` in unpackaged
 * builds): Playwright cannot plug in a projector, so tests add and remove
 * displays through `globalThis.__cmpTest.screen`. Fake displays are carved
 * out of the real primary display so their windows are visible on screen.
 */
export class FakeScreen implements ScreenSource {
  private displays: DisplayLike[];
  private readonly listeners = new Map<ScreenEvent, Listener[]>();

  constructor(private readonly primary: DisplayLike) {
    this.displays = [primary];
  }

  getAllDisplays(): DisplayLike[] {
    return [...this.displays];
  }

  getPrimaryDisplay(): DisplayLike {
    return this.primary;
  }

  on(event: ScreenEvent, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  add(
    display: Partial<DisplayLike> & { id: number; bounds: Rect },
  ): DisplayLike {
    const full: DisplayLike = {
      label: `Fake projector ${display.id}`,
      workArea: display.bounds,
      scaleFactor: 1,
      internal: false,
      ...display,
    };
    this.displays.push(full);
    this.emit("display-added", full);
    return full;
  }

  remove(id: number): void {
    const display = this.displays.find((candidate) => candidate.id === id);
    if (!display) return;
    this.displays = this.displays.filter((candidate) => candidate.id !== id);
    this.emit("display-removed", display);
  }

  change(id: number, patch: Partial<DisplayLike>): void {
    this.displays = this.displays.map((display) =>
      display.id === id ? { ...display, ...patch } : display,
    );
    const changed = this.displays.find((display) => display.id === id);
    if (changed) this.emit("display-metrics-changed", changed);
  }

  private emit(event: ScreenEvent, display: DisplayLike): void {
    for (const listener of this.listeners.get(event) ?? []) listener(display);
  }
}

/** Adapts Electron's `screen` (whose listeners get `(event, display)`). */
export function electronScreenSource(screen: {
  getAllDisplays(): DisplayLike[];
  getPrimaryDisplay(): DisplayLike;
  on(
    event: ScreenEvent,
    listener: (event: unknown, display: DisplayLike) => void,
  ): unknown;
}): ScreenSource {
  return {
    getAllDisplays: () => screen.getAllDisplays(),
    getPrimaryDisplay: () => screen.getPrimaryDisplay(),
    on: (event, listener) => {
      screen.on(event, (_event, display) => listener(display));
    },
  };
}
