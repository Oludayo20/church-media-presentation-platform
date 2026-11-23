// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createOutputSurface } from "../index";

describe("createOutputSurface", () => {
  it("replaces root content with a black, cursorless stage", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>stale</p>";

    const surface = createOutputSurface(root);

    expect(root.children).toHaveLength(1);
    expect(root.firstElementChild).toBe(surface.stage);
    expect(surface.stage.style.background).toMatch(/#000|rgb\(0, 0, 0\)/);
    expect(surface.stage.style.cursor).toBe("none");
  });

  it("removes the stage on destroy", () => {
    const root = document.createElement("div");
    const surface = createOutputSurface(root);
    surface.destroy();
    expect(root.children).toHaveLength(0);
  });
});
