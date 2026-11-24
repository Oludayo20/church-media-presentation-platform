// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPresentationEngine,
  type EngineCommandBody,
  type EngineDocumentInput,
  type EngineState,
  type PresentationEngine,
} from "../index";
import { installMediaStubs } from "./media-stubs";

const asset = (n: number) =>
  `cmp-media://asset/01JD${String(n).padStart(22, "0")}`;
const MOTION = asset(1);
const PHOTO = asset(2);
const CLIP = asset(3);

function text(id: string, content: string, role: "body" | "footer" = "body") {
  return {
    id,
    type: "text" as const,
    frame: { x: 0, y: 0, w: 1920, h: 1080 },
    content,
    role,
  };
}

function deck(
  id: string,
  count: number,
  background: EngineDocumentInput["slides"][number]["background"] = {
    type: "color",
    value: "#101820",
  },
): EngineDocumentInput {
  return {
    schemaVersion: "cmp.presentation/v1",
    id,
    title: id,
    width: 1920,
    height: 1080,
    slides: Array.from({ length: count }, (_, index) => ({
      id: `${id}-s${index}`,
      background,
      objects: [text(`${id}-t${index}`, `${id} slide ${index}`)],
    })),
  };
}

let root: HTMLElement;
let engine: PresentationEngine;
let seq: number;
let states: EngineState[];

const send = (body: EngineCommandBody) =>
  engine.apply({ ...body, seq: ++seq } as never);
const stage = () =>
  root.querySelector<HTMLElement>("[data-cmp-deck]:last-of-type")!;
const visibleText = () =>
  [
    ...root.querySelectorAll<HTMLElement>(
      '[data-cmp-plane="content"] [data-cmp-layer]',
    ),
  ]
    .filter((layer) => layer.style.visibility === "visible")
    .map((layer) => layer.textContent)
    .join("|");

beforeAll(installMediaStubs);

beforeEach(async () => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  states = [];
  seq = 0;
  engine = createPresentationEngine(root, {
    mediaTimeoutMs: 10,
    onState: (state) => states.push(state),
  });
  await send({
    type: "config",
    config: {
      fallbackBackground: { type: "color", value: "#123456" },
      logoSrc: null,
      logoText: "Grace Chapel",
      safeAreaPct: 5,
      defaultTransition: { type: "cut", ms: 0 },
    },
  });
});

describe("loading and navigation", () => {
  it("renders the start slide of a loaded document", async () => {
    await send({ type: "load", doc: deck("song", 3), startSlide: 1 });
    expect(stage().dataset["cmpSlideIndex"]).toBe("1");
    expect(visibleText()).toBe("song slide 1");
    expect(engine.getState()).toMatchObject({
      docId: "song",
      slideIndex: 1,
      slideCount: 3,
      overlayDepth: 0,
    });
  });

  it("pre-renders the next slide into the back layer", async () => {
    await send({ type: "load", doc: deck("song", 3), startSlide: 0 });
    const hidden = [
      ...root.querySelectorAll<HTMLElement>(
        '[data-cmp-plane="content"] [data-cmp-layer]',
      ),
    ].find((layer) => layer.style.visibility === "hidden");
    expect(hidden?.textContent).toBe("song slide 1");
  });

  it("goes to a slide", async () => {
    await send({ type: "load", doc: deck("song", 3), startSlide: 0 });
    await send({ type: "goto", slideIndex: 2 });
    expect(visibleText()).toBe("song slide 2");
  });

  it("ignores out-of-range gotos with a warning", async () => {
    await send({ type: "load", doc: deck("song", 3), startSlide: 1 });
    await send({ type: "goto", slideIndex: 3 });
    await send({ type: "goto", slideIndex: -1 });
    expect(engine.getState().slideIndex).toBe(1);
    expect(engine.getState().warnings.map((w) => w.code)).toEqual([
      "OUT_OF_RANGE",
      "OUT_OF_RANGE",
    ]);
  });

  it("clamps an out-of-range start slide", async () => {
    await send({ type: "load", doc: deck("song", 3), startSlide: 99 });
    expect(engine.getState().slideIndex).toBe(2);
  });

  it("coalesces a burst of gotos to the last one", async () => {
    await send({ type: "load", doc: deck("song", 10), startSlide: 0 });
    const shown: string[] = [];
    const observer = new MutationObserver(() =>
      shown.push(stage().dataset["cmpSlideIndex"]!),
    );
    observer.observe(stage(), {
      attributes: true,
      attributeFilter: ["data-cmp-slide-index"],
    });
    await Promise.all(
      [1, 2, 3, 4].map((slideIndex) => send({ type: "goto", slideIndex })),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    expect(engine.getState().slideIndex).toBe(4);
    expect(shown.length).toBeLessThan(4);
  });
});

describe("sequence numbers", () => {
  it("drops commands at or below lastSeq (idempotent replays)", async () => {
    await engine.apply({
      seq: 10,
      type: "load",
      doc: deck("a", 3),
      startSlide: 0,
    });
    await engine.apply({ seq: 11, type: "goto", slideIndex: 2 });
    await engine.apply({ seq: 11, type: "goto", slideIndex: 1 });
    await engine.apply({ seq: 5, type: "goto", slideIndex: 0 });
    await engine.apply({ seq: 5, type: "mask", mask: "black" });
    expect(engine.getState()).toMatchObject({
      lastSeq: 11,
      slideIndex: 2,
      mask: "none",
    });
  });

  it("reports lastSeq in emitted state", async () => {
    await engine.apply({
      seq: 42,
      type: "load",
      doc: deck("a", 1),
      startSlide: 0,
    });
    await Promise.resolve();
    expect(states.at(-1)?.lastSeq).toBe(42);
  });
});

describe("document validation", () => {
  it("rejects documents with non-workspace media and keeps the current slide", async () => {
    await send({ type: "load", doc: deck("good", 2), startSlide: 1 });
    const bad = deck("bad", 1, {
      type: "image",
      src: "https://evil.example/x.png",
    } as never);
    await send({ type: "load", doc: bad, startSlide: 0 });
    expect(engine.getState()).toMatchObject({ docId: "good", slideIndex: 1 });
    expect(engine.getState().warnings[0]?.code).toBe("INVALID_DOCUMENT");
    expect(root.querySelector("img")).toBeNull();
  });

  it("rejects unknown schema versions", async () => {
    await send({
      type: "load",
      doc: { ...deck("x", 1), schemaVersion: "cmp.presentation/v9" } as never,
      startSlide: 0,
    });
    expect(engine.getState().docId).toBeNull();
  });
});

describe("media", () => {
  it("replaces a failed background with the fallback colour and warns", async () => {
    await send({
      type: "load",
      doc: deck("photo", 2, { type: "image", src: PHOTO }),
      startSlide: 0,
    });
    const image = root.querySelector<HTMLImageElement>(
      '[data-cmp-media="background"]',
    )!;
    image.dispatchEvent(new Event("error"));
    await Promise.resolve();
    const fallback = root.querySelector<HTMLElement>("[data-cmp-fallback]");
    expect(fallback?.style.background).toMatch(/#123456|rgb\(18, 52, 86\)/);
    expect(root.querySelector('img[data-cmp-media="background"]')).toBeNull();
    expect(engine.getState().warnings).toContainEqual(
      expect.objectContaining({ code: "MEDIA_FAILED", src: PHOTO }),
    );
  });

  it("keeps the same background <video> element across slides that share it", async () => {
    await send({
      type: "load",
      doc: deck("song", 3, { type: "video", src: MOTION }),
      startSlide: 0,
    });
    const before = root.querySelector("video[data-cmp-src]");
    expect(before).not.toBeNull();
    expect((before as HTMLVideoElement).paused).toBe(false);
    await send({ type: "goto", slideIndex: 1 });
    await send({ type: "goto", slideIndex: 2 });
    const videos = root.querySelectorAll('[data-cmp-plane="background"] video');
    expect(videos).toHaveLength(1);
    expect(videos[0]).toBe(before);
    expect((before as HTMLVideoElement).paused).toBe(false);
  });

  it("keeps the background playing when the next item uses the same one", async () => {
    await send({
      type: "load",
      doc: deck("song-a", 2, { type: "video", src: MOTION }),
      startSlide: 1,
    });
    const before = root.querySelector('[data-cmp-plane="background"] video');
    await send({
      type: "load",
      doc: deck("song-b", 2, { type: "video", src: MOTION }),
      startSlide: 0,
    });
    expect(
      root.querySelector(
        '[data-cmp-plane="background"] [data-cmp-layer][style*="visible"] video',
      ),
    ).toBe(before);
  });

  it("swaps the background when it changes", async () => {
    const doc = deck("mixed", 2, { type: "video", src: MOTION });
    doc.slides[1]!.background = { type: "color", value: "#000000" };
    await send({ type: "load", doc, startSlide: 0 });
    const video = root.querySelector<HTMLVideoElement>(
      '[data-cmp-plane="background"] video',
    )!;
    await send({ type: "goto", slideIndex: 1 });
    expect(video.isConnected ? video.paused : true).toBe(true);
  });

  it("drives the transport on the foreground video", async () => {
    const doc = deck("clip", 1);
    doc.slides[0]!.objects = [
      {
        id: "v",
        type: "video",
        frame: { x: 0, y: 0, w: 1920, h: 1080 },
        src: CLIP,
      },
    ];
    await send({ type: "load", doc, startSlide: 0 });
    expect(engine.getState().video).toMatchObject({ src: CLIP, paused: false });
    await send({ type: "video", action: "toggle" });
    expect(engine.getState().video?.paused).toBe(true);
    await send({ type: "video", action: "seek", value: 12_500 });
    expect(engine.getState().video?.timeMs).toBe(12_500);
    await send({ type: "video", action: "volume", value: 0.4 });
    expect(engine.getState().video?.volume).toBeCloseTo(0.4);
    await send({ type: "video", action: "stop" });
    expect(engine.getState().video).toMatchObject({ timeMs: 0, paused: true });
  });
});

describe("masks and clear", () => {
  it("BLACK and LOGO cover the output instantly, even while a slide is loading", async () => {
    await send({ type: "load", doc: deck("song", 2), startSlide: 0 });
    const slow = deck("slow", 1, { type: "image", src: PHOTO });
    const loading = send({ type: "load", doc: slow, startSlide: 0 });
    await send({ type: "mask", mask: "black" });
    const layer = root.querySelector<HTMLElement>("[data-cmp-mask]")!;
    expect(layer.dataset["cmpMask"]).toBe("black");
    expect(layer.style.display).toBe("flex");
    await loading;

    await send({ type: "mask", mask: "logo" });
    expect(layer.textContent).toBe("Grace Chapel");
    await send({ type: "mask", mask: "none" });
    expect(layer.style.display).toBe("none");
  });

  it("CLEAR hides lyric text but keeps footers and the background", async () => {
    const doc = deck("scripture", 2);
    doc.slides.forEach((slide) =>
      slide.objects.push(text(`${slide.id}-ref`, "John 3:16 KJV", "footer")),
    );
    await send({ type: "load", doc, startSlide: 0 });
    await send({ type: "clear", on: true });
    const body = root.querySelector<HTMLElement>(
      '[data-cmp-layer][style*="visible"] [data-cmp-role="body"]',
    )!;
    const footer = root.querySelector<HTMLElement>(
      '[data-cmp-layer][style*="visible"] [data-cmp-role="footer"]',
    )!;
    expect(body.style.visibility).toBe("hidden");
    expect(footer.style.visibility).toBe("");
    // Stays cleared on the next slide until turned off.
    await send({ type: "goto", slideIndex: 1 });
    expect(
      root.querySelector<HTMLElement>(
        '[data-cmp-layer][style*="visible"] [data-cmp-role="body"]',
      )!.style.visibility,
    ).toBe("hidden");
    await send({ type: "clear", on: false });
    expect(
      root.querySelector<HTMLElement>(
        '[data-cmp-layer][style*="visible"] [data-cmp-role="body"]',
      )!.style.visibility,
    ).toBe("");
  });
});

describe("overlays", () => {
  it("pushes over the current item and pops back to the same slide and video", async () => {
    await send({
      type: "load",
      doc: deck("song", 4, { type: "video", src: MOTION }),
      startSlide: 2,
    });
    const motion = root.querySelector<HTMLVideoElement>("video")!;
    expect(motion.paused).toBe(false);

    await send({ type: "overlay:push", doc: deck("verse", 2), startSlide: 0 });
    expect(engine.getState()).toMatchObject({
      docId: "verse",
      overlayDepth: 1,
      slideIndex: 0,
    });
    expect(motion.paused).toBe(true);

    // Navigation applies to the overlay.
    await send({ type: "goto", slideIndex: 1 });
    expect(engine.getState()).toMatchObject({ docId: "verse", slideIndex: 1 });

    await send({ type: "overlay:pop" });
    expect(engine.getState()).toMatchObject({
      docId: "song",
      slideIndex: 2,
      overlayDepth: 0,
    });
    expect(motion.paused).toBe(false);
  });

  it("a new load replaces any overlays", async () => {
    await send({ type: "load", doc: deck("song", 2), startSlide: 0 });
    await send({ type: "overlay:push", doc: deck("verse", 1), startSlide: 0 });
    await send({ type: "load", doc: deck("next", 1), startSlide: 0 });
    expect(engine.getState()).toMatchObject({ docId: "next", overlayDepth: 0 });
    expect(root.querySelectorAll("[data-cmp-deck]")).toHaveLength(1);
  });
});

describe("live edits", () => {
  it("patches the visible slide in place", async () => {
    await send({ type: "load", doc: deck("song", 2), startSlide: 0 });
    await send({
      type: "patch",
      slideId: "song-s0",
      slide: {
        id: "song-s0",
        background: { type: "color", value: "#101820" },
        objects: [text("t", "Fixed lyric")],
      },
    });
    expect(visibleText()).toBe("Fixed lyric");
  });
});

describe("output", () => {
  it("letterboxes the document into the output", async () => {
    await send({ type: "load", doc: deck("song", 1), startSlide: 0 });
    const viewport = root.querySelector<HTMLElement>("[data-cmp-engine]")!;
    Object.defineProperty(viewport, "clientWidth", { value: 1024 });
    Object.defineProperty(viewport, "clientHeight", { value: 768 });
    engine.relayout();
    // 4:3 projector: scale 1024/1920, bars top and bottom.
    expect(stage().style.transform).toMatch(
      /^translate\(0px, 96px\) scale\(0\.5333/,
    );
  });

  it("shows and hides the test pattern with the safe area", async () => {
    await send({ type: "test-pattern", on: true });
    expect(root.querySelector("[data-cmp-safe-area='5']")).not.toBeNull();
    expect(engine.getState().testPattern).toBe(true);
    await send({ type: "test-pattern", on: false });
    expect(root.querySelector("[data-cmp-test-pattern]")).toBeNull();
  });

  it("unload returns to black", async () => {
    await send({ type: "load", doc: deck("song", 1), startSlide: 0 });
    await send({ type: "unload" });
    expect(engine.getState()).toMatchObject({ docId: null, slideCount: 0 });
    expect(visibleText()).toBe("");
  });

  it("destroy removes everything", () => {
    engine.destroy();
    expect(root.children).toHaveLength(0);
  });
});

describe("preview mode", () => {
  it("is always muted", async () => {
    const previewRoot = document.createElement("div");
    const preview = createPresentationEngine(previewRoot, {
      mode: "preview",
      mediaTimeoutMs: 10,
    });
    const doc = deck("clip", 1);
    doc.slides[0]!.objects = [
      {
        id: "v",
        type: "video",
        frame: { x: 0, y: 0, w: 10, h: 10 },
        src: CLIP,
        muted: false,
      },
    ];
    await preview.apply({ seq: 1, type: "load", doc, startSlide: 0 });
    await preview.apply({ seq: 2, type: "video", action: "mute", value: 0 });
    expect(previewRoot.querySelector("video")!.muted).toBe(true);
    preview.destroy();
  });
});

describe("replay ordering", () => {
  it("applies a video seek sent right after a load to the newly loaded video", async () => {
    const doc = deck("clip", 1);
    doc.slides[0]!.objects = [
      {
        id: "v",
        type: "video",
        frame: { x: 0, y: 0, w: 1920, h: 1080 },
        src: CLIP,
      },
    ];
    const loading = send({ type: "load", doc, startSlide: 0 });
    const seeking = send({ type: "video", action: "seek", value: 7000 });
    await Promise.all([loading, seeking]);
    expect(engine.getState().video).toMatchObject({ src: CLIP, timeMs: 7000 });
  });
});

describe("fades", () => {
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(async () => {
    await send({
      type: "config",
      config: {
        fallbackBackground: { type: "color", value: "#123456" },
        logoSrc: null,
        logoText: null,
        safeAreaPct: 5,
        defaultTransition: { type: "fade", ms: 40 },
      },
    });
  });

  it("crossfades over the previous slide, which stays underneath until the fade ends", async () => {
    await send({ type: "load", doc: deck("song", 3), startSlide: 0 });
    await sleep(60);
    await send({ type: "goto", slideIndex: 1 });
    // Mid-fade: the outgoing slide is still there beneath the incoming one.
    const layers = [
      ...root.querySelectorAll<HTMLElement>(
        '[data-cmp-plane="content"] [data-cmp-layer]',
      ),
    ];
    expect(layers.map((layer) => layer.textContent).sort()).toEqual([
      "song slide 0",
      "song slide 1",
    ]);
    await sleep(60);
    // After the fade the old layer is reused to pre-render slide 2.
    expect(layers.map((layer) => layer.textContent).sort()).toEqual([
      "song slide 1",
      "song slide 2",
    ]);
    expect(visibleText()).toBe("song slide 1");
  });

  it("a goto during a running fade never leaves an empty picture", async () => {
    await send({ type: "load", doc: deck("a", 1), startSlide: 0 });
    // Load a different item mid-fade (the e2e failure mode).
    await send({ type: "load", doc: deck("b", 1), startSlide: 0 });
    await sleep(80);
    expect(visibleText()).toBe("b slide 0");
    await send({ type: "load", doc: deck("c", 2), startSlide: 0 });
    await send({ type: "goto", slideIndex: 1 });
    await sleep(80);
    expect(visibleText()).toBe("c slide 1");
  });
});

describe("stacking", () => {
  it("keeps the content plane above the background plane whatever the layer order", async () => {
    await send({
      type: "load",
      doc: deck("song", 2, { type: "video", src: MOTION }),
      startSlide: 0,
    });
    const plane = (name: string) =>
      root.querySelector<HTMLElement>(`[data-cmp-plane="${name}"]`)!.style;
    // Both planes isolate their layers' z-index (used during fades)…
    expect(plane("background").isolation).toBe("isolate");
    expect(plane("content").isolation).toBe("isolate");
    // …and the content plane sits above the background plane.
    expect(Number(plane("content").zIndex)).toBeGreaterThan(
      Number(plane("background").zIndex),
    );
  });
});

describe("countdown clocks", () => {
  const countdownDeck = (durationMs: number): EngineDocumentInput => ({
    schemaVersion: "cmp.presentation/v1",
    id: "countdown",
    title: "Countdown",
    width: 1920,
    height: 1080,
    slides: [
      {
        id: "c1",
        background: { type: "color", value: "#000000" },
        objects: [{ id: "clock", type: "countdown", frame: { x: 0, y: 0, w: 1920, h: 400 }, durationMs }],
      },
      {
        id: "c2",
        background: { type: "color", value: "#000000" },
        objects: [{ id: "clock", type: "countdown", frame: { x: 0, y: 0, w: 1920, h: 400 }, durationMs }],
      },
    ],
  });
  const clockText = () =>
    [...root.querySelectorAll<HTMLElement>("[data-cmp-countdown]")].find(
      (element) => element.closest<HTMLElement>("[data-cmp-layer]")?.style.visibility === "visible",
    )?.textContent;

  it("shows its duration until started, then counts down from the shared end time", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-29T08:50:00Z"));
      await send({ type: "load", doc: countdownDeck(600_000), startSlide: 0 });
      expect(clockText()).toBe("10:00");

      await send({ type: "timer", endsAt: Date.now() + 600_000 });
      vi.advanceTimersByTime(61_000);
      expect(clockText()).toBe("08:59");

      // A slide rendered while the timer runs shows the running time at once.
      await send({ type: "goto", slideIndex: 1 });
      expect(clockText()).toBe("08:59");

      vi.advanceTimersByTime(10 * 60_000);
      expect(clockText()).toBe("00:00"); // never negative

      await send({ type: "timer", endsAt: null });
      expect(clockText()).toBe("10:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("formats hours and survives a chime without an audio device", async () => {
    await send({ type: "load", doc: countdownDeck(3_900_000), startSlide: 0 });
    expect(clockText()).toBe("1:05:00");
    await expect(send({ type: "chime" })).resolves.toBeUndefined();
  });
});
