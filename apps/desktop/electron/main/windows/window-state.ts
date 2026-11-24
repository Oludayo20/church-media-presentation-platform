import type { SavedWindowState } from "../config/config-store";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSizing {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface RestoredWindowState {
  /** x/y are omitted when the window should be centred. */
  bounds: { width: number; height: number; x?: number; y?: number };
  maximized: boolean;
  fullScreen: boolean;
}

/** Minimum overlap with a display's work area for saved x/y to be reused. */
const MIN_VISIBLE = { width: 120, height: 60 };

/**
 * Restores saved bounds only if enough of the window would land on a
 * connected display. Otherwise (projector unplugged, resolution changed) the
 * window is centred on the primary display, never lost off-screen.
 */
export function restoreWindowState(
  saved: SavedWindowState | undefined,
  workAreas: readonly Rect[],
  sizing: WindowSizing,
): RestoredWindowState {
  if (!saved) {
    return {
      bounds: { width: sizing.width, height: sizing.height },
      maximized: false,
      fullScreen: false,
    };
  }

  const largest = workAreas.reduce(
    (max, area) => ({
      width: Math.max(max.width, area.width),
      height: Math.max(max.height, area.height),
    }),
    { width: sizing.width, height: sizing.height },
  );
  const width = clamp(saved.width, sizing.minWidth, largest.width);
  const height = clamp(saved.height, sizing.minHeight, largest.height);
  const candidate = { x: saved.x, y: saved.y, width, height };
  const visible = workAreas.some((area) => {
    const overlap = intersect(candidate, area);
    return (
      overlap.width >= MIN_VISIBLE.width && overlap.height >= MIN_VISIBLE.height
    );
  });

  return {
    bounds: visible ? candidate : { width, height },
    maximized: saved.maximized,
    fullScreen: saved.fullScreen,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function intersect(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.max(
      0,
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    ),
    height: Math.max(
      0,
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    ),
  };
}
