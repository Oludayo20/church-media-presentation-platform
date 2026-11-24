import { describe, expect, it } from "vitest";
import { restoreWindowState } from "../window-state";

const sizing = { width: 1440, height: 900, minWidth: 1024, minHeight: 640 };
const laptop = { x: 0, y: 25, width: 1512, height: 920 };
const projector = { x: 1512, y: 0, width: 1920, height: 1080 };
const saved = (x: number, y: number, width = 1200, height = 800) => ({
  x,
  y,
  width,
  height,
  maximized: false,
  fullScreen: false,
});

describe("restoreWindowState", () => {
  it("uses the default size, centred, on first launch", () => {
    expect(restoreWindowState(undefined, [laptop], sizing)).toEqual({
      bounds: { width: 1440, height: 900 },
      maximized: false,
      fullScreen: false,
    });
  });

  it("restores saved bounds on a connected display", () => {
    expect(
      restoreWindowState(saved(100, 100), [laptop], sizing).bounds,
    ).toEqual({ x: 100, y: 100, width: 1200, height: 800 });
  });

  it("restores onto a second display that is still connected", () => {
    expect(
      restoreWindowState(saved(1700, 50), [laptop, projector], sizing).bounds,
    ).toMatchObject({ x: 1700, y: 50 });
  });

  it("re-centres when the saved display is gone", () => {
    const restored = restoreWindowState(saved(1700, 50), [laptop], sizing);
    expect(restored.bounds).toEqual({ width: 1200, height: 800 });
  });

  it("re-centres when only a sliver would be visible", () => {
    expect(
      restoreWindowState(saved(1450, 100), [laptop], sizing).bounds,
    ).not.toHaveProperty("x");
  });

  it("clamps the size between the minimum and the largest display", () => {
    expect(
      restoreWindowState(saved(0, 25, 400, 300), [laptop], sizing).bounds,
    ).toMatchObject({ width: 1024, height: 640 });
    expect(
      restoreWindowState(saved(0, 25, 5000, 3000), [laptop], sizing).bounds,
    ).toMatchObject({ width: 1512, height: 920 });
  });

  it("keeps the maximised and full-screen flags", () => {
    const restored = restoreWindowState(
      { ...saved(0, 25), maximized: true, fullScreen: true },
      [laptop],
      sizing,
    );
    expect(restored).toMatchObject({ maximized: true, fullScreen: true });
  });
});
