// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS } from "@cmp/shared-validation";
import {
  actionFor,
  comboFromEvent,
  formatCombo,
  isTypingTarget,
  rebind,
} from "../shortcuts";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("comboFromEvent", () => {
  it("normalises keys", () => {
    expect(comboFromEvent(key({ key: "B" }))).toBe("b");
    expect(comboFromEvent(key({ key: " " }))).toBe("Space");
    expect(comboFromEvent(key({ key: "PageDown" }))).toBe("PageDown");
    expect(comboFromEvent(key({ key: "Shift" }))).toBeNull();
    expect(comboFromEvent(key({ key: "ArrowRight", shiftKey: true }))).toBe(
      "Shift+ArrowRight",
    );
  });

  it("maps the platform modifier to Mod", () => {
    const mac = /Mac/.test(navigator.platform);
    expect(comboFromEvent(key({ key: "f", metaKey: mac, ctrlKey: !mac }))).toBe(
      "Mod+f",
    );
  });
});

describe("actionFor", () => {
  it("resolves defaults, including presentation clickers", () => {
    expect(actionFor(DEFAULT_SHORTCUTS, "PageDown")).toBe("next");
    expect(actionFor(DEFAULT_SHORTCUTS, "PageUp")).toBe("prev");
    expect(actionFor(DEFAULT_SHORTCUTS, "b")).toBe("black");
    expect(actionFor(DEFAULT_SHORTCUTS, "z")).toBeNull();
  });
});

describe("rebind", () => {
  it("moves a combo from one action to another", () => {
    const next = rebind(DEFAULT_SHORTCUTS, "logo", "b");
    expect(next.logo).toEqual(["l", "b"]);
    expect(next.black).toEqual([]);
    expect(actionFor(next, "b")).toBe("logo");
  });
});

describe("isTypingTarget", () => {
  it("guards text inputs, editable content and dialogs", () => {
    document.body.innerHTML = `
      <input id="text" />
      <input id="check" type="checkbox" />
      <div id="edit" contenteditable="true"></div>
      <div role="dialog"><button id="inDialog">x</button></div>
      <button id="plain">y</button>`;
    const get = (id: string) => document.getElementById(id);
    expect(isTypingTarget(get("text"))).toBe(true);
    expect(isTypingTarget(get("check"))).toBe(false);
    expect(isTypingTarget(get("edit"))).toBe(true);
    expect(isTypingTarget(get("inDialog"))).toBe(true);
    expect(isTypingTarget(get("plain"))).toBe(false);
  });
});

describe("formatCombo", () => {
  it("renders arrows and letters", () => {
    expect(formatCombo("ArrowRight")).toBe("→");
    expect(formatCombo("b")).toBe("B");
  });
});
