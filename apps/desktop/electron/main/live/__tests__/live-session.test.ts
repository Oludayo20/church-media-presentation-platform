import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EngineCommandBody,
  EngineDocumentInput,
  EngineState,
} from "@cmp/shared-validation";
import { engineDocumentSchema } from "@cmp/shared-validation";
import { silentLogger } from "../../logging/logger";
import { buildDemoPlaylist } from "../demo-playlist";
import {
  LiveSessionController,
  type EngineSink,
  type LiveJournal,
  type PlaylistItem,
} from "../live-session";

function doc(id: string, count: number): PlaylistItem {
  const input: EngineDocumentInput = {
    schemaVersion: "cmp.presentation/v1",
    id,
    title: id,
    width: 1920,
    height: 1080,
    slides: Array.from({ length: count }, (_, i) => ({
      id: `${id}-${i}`,
      background: { type: "color", value: "#000000" },
      objects: [],
    })),
  };
  return {
    id,
    title: id,
    kind: "song",
    doc: engineDocumentSchema.parse(input),
  };
}

class RecordingSink implements EngineSink {
  commands: EngineCommandBody[] = [];
  constructor(readonly id: string) {}
  send(command: EngineCommandBody) {
    this.commands.push(command);
  }
  types() {
    return this.commands.map((c) => c.type);
  }
}

const config = {
  fallbackBackground: { type: "color" as const, value: "#000" },
  logoSrc: null,
  logoText: "Grace",
  safeAreaPct: 5,
  defaultTransition: { type: "fade" as const, ms: 300 },
};

let journal: { [K in keyof LiveJournal]: ReturnType<typeof vi.fn> };
let controller: LiveSessionController;
let audience: RecordingSink;

beforeEach(() => {
  vi.useFakeTimers();
  journal = {
    start: vi.fn(async () => ({ id: "S1" })),
    save: vi.fn(async () => {}),
    end: vi.fn(async () => "2026-01-01T00:00:00.000Z"),
  };
  controller = new LiveSessionController({
    loadPlaylist: async () => [doc("a", 3), doc("b", 2), doc("verse", 2)],
    engineConfig: async () => config,
    journal: () => journal as unknown as LiveJournal,
    displayProfileId: () => "P1",
    onState: () => {},
    logger: silentLogger,
  });
  audience = new RecordingSink("audience");
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

const start = async (output: "display" | "preview" = "display") => {
  await controller.addSink(audience, { primary: true });
  audience.commands = [];
  return controller.start({ output });
};

describe("lifecycle", () => {
  it("is idle until started, then live on the first slide", async () => {
    expect(controller.state().status).toBe("idle");
    const state = await start();
    expect(state).toMatchObject({
      status: "live",
      sessionId: "S1",
      itemIndex: 0,
      slideIndex: 0,
    });
    expect(state.items.map((i) => i.slideCount)).toEqual([3, 2, 2]);
    expect(audience.types()).toEqual(["config", "test-pattern", "load", "timer", "mask", "clear"]);
    expect(journal.start).toHaveBeenCalledWith({
      serviceId: null,
      displayProfileId: "P1",
    });
  });

  it("refuses a second start", async () => {
    await start();
    await expect(controller.start({ output: "display" })).rejects.toMatchObject(
      { code: "LIVE_SESSION_ACTIVE" },
    );
  });

  it("commands without a session are rejected", () => {
    expect(() => controller.next()).toThrow(/No live session/);
  });

  it("ends: engines unload, journal closed, back to idle", async () => {
    await start();
    await controller.end();
    expect(audience.types().at(-1)).toBe("unload");
    expect(journal.end).toHaveBeenCalledWith("S1");
    expect(controller.state().status).toBe("idle");
  });
});

describe("navigation", () => {
  it("next walks slides, then rolls into the next item", async () => {
    await start();
    controller.next();
    controller.next();
    expect(controller.state()).toMatchObject({ itemIndex: 0, slideIndex: 2 });
    controller.next();
    expect(controller.state()).toMatchObject({ itemIndex: 1, slideIndex: 0 });
    // One load from start(), one for rolling into item b.
    expect(audience.commands.filter((c) => c.type === "load")).toHaveLength(2);
  });

  it("prev before the first slide goes to the previous item's last slide", async () => {
    await start();
    controller.itemGoto(1);
    controller.prev();
    expect(controller.state()).toMatchObject({ itemIndex: 0, slideIndex: 2 });
    expect(audience.commands.at(-2)).toMatchObject({
      type: "load",
      startSlide: 2,
    });
  });

  it("stops at the very end and the very start", async () => {
    await start();
    controller.itemGoto(2);
    controller.next();
    controller.next();
    expect(controller.state()).toMatchObject({ itemIndex: 2, slideIndex: 1 });
    controller.itemGoto(0);
    controller.prev();
    expect(controller.state()).toMatchObject({ itemIndex: 0, slideIndex: 0 });
  });

  it("goto validates the slide number", async () => {
    await start();
    expect(controller.goto(2).slideIndex).toBe(2);
    expect(() => controller.goto(3)).toThrow(/no slide 4/);
  });

  it("item changes reset CLEAR but keep BLACK", async () => {
    await start();
    controller.clear(true);
    controller.blank(true);
    controller.itemNext();
    expect(controller.state()).toMatchObject({
      cleared: false,
      mask: "black",
      status: "masked",
    });
  });
});

describe("masks", () => {
  it("BLACK and LOGO toggle and the status follows", async () => {
    await start();
    expect(controller.blank(true).status).toBe("masked");
    expect(controller.logo(true).mask).toBe("logo");
    // Turning BLACK off while LOGO is up leaves LOGO.
    expect(controller.blank(false).mask).toBe("logo");
    expect(controller.logo(false)).toMatchObject({
      mask: "none",
      status: "live",
    });
  });
});

describe("timed slides", () => {
  it("advances a timed slide and suspends its timer while masked", async () => {
    await start();
    const item = doc("timed", 2);
    item.doc.slides[0]!.durationMs = 2000;
    controller.appendItem(item);
    controller.itemGoto(3);
    controller.blank(true);
    vi.advanceTimersByTime(3000);
    expect(controller.state().slideIndex).toBe(0);
    controller.blank(false);
    vi.advanceTimersByTime(1999);
    expect(controller.state().slideIndex).toBe(0);
    vi.advanceTimersByTime(1);
    expect(controller.state().slideIndex).toBe(1);
  });
});

describe("overlays", () => {
  it("push → navigate the overlay → pop restores item, slide and video", async () => {
    await start();
    controller.goto(1);
    const video = {
      src: "v",
      timeMs: 42_000,
      durationMs: 60_000,
      paused: false,
      muted: false,
      volume: 1,
    };
    controller.handleEngineState("audience", engineState({ video }));

    expect(controller.overlayPush(2)).toMatchObject({
      status: "overlay",
      overlay: { depth: 1, itemIndex: 2, slideIndex: 0, slideCount: 2 },
    });
    controller.next();
    expect(controller.state().overlay?.slideIndex).toBe(1);
    expect(controller.state().slideIndex).toBe(1); // base untouched

    controller.handleEngineState("audience", engineState({ video: null }));
    const popped = controller.overlayPop();
    expect(popped).toMatchObject({
      status: "live",
      overlay: null,
      itemIndex: 0,
      slideIndex: 1,
    });
    expect(popped.video?.timeMs).toBe(42_000);
    expect(audience.types().slice(-1)).toEqual(["overlay:pop"]);
  });

  it("changing item drops overlays", async () => {
    await start();
    controller.overlayPush(2);
    controller.itemNext();
    expect(controller.state()).toMatchObject({ overlay: null, itemIndex: 1 });
  });
});

describe("output and suspension", () => {
  it("disconnected → suspended → restored returns to the previous state", async () => {
    await start();
    controller.blank(true);
    controller.setOutput("disconnected");
    expect(controller.state().status).toBe("suspended");
    // The operator can keep working while suspended.
    controller.next();
    controller.setOutput("display");
    expect(controller.state()).toMatchObject({
      status: "masked",
      slideIndex: 1,
    });
  });

  it("a reconnecting engine is replayed to exactly the current picture", async () => {
    await start();
    controller.itemGoto(1);
    controller.next();
    controller.blank(true);
    controller.clear(true);
    controller.handleEngineState(
      "audience",
      engineState({
        video: {
          src: "v",
          timeMs: 9000,
          durationMs: null,
          paused: true,
          muted: false,
          volume: 1,
        },
      }),
    );
    controller.overlayPush(2);

    const fresh = new RecordingSink("audience");
    await controller.addSink(fresh, { primary: true });
    expect(fresh.commands).toEqual([
      { type: "config", config },
      { type: "test-pattern", on: false },
      {
        type: "load",
        doc: expect.objectContaining({ id: "b" }),
        startSlide: 1,
      },
      { type: "video", action: "seek", value: 9000 },
      { type: "video", action: "pause" },
      { type: "timer", endsAt: null },
      { type: "mask", mask: "black" },
      { type: "clear", on: true },
      {
        type: "overlay:push",
        doc: expect.objectContaining({ id: "verse" }),
        startSlide: 0,
      },
    ]);
  });

  it("only the primary engine's reports are trusted", async () => {
    await start();
    controller.handleEngineState(
      "mirror",
      engineState({
        video: {
          src: "x",
          timeMs: 1,
          durationMs: null,
          paused: false,
          muted: true,
          volume: 1,
        },
      }),
    );
    expect(controller.state().video).toBeNull();
  });
});

describe("journal", () => {
  it("debounces slide changes to 250 ms and flushes item changes at once", async () => {
    await start();
    journal.save.mockClear();
    controller.next();
    controller.next();
    expect(journal.save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(journal.save).toHaveBeenCalledTimes(1);
    expect(journal.save).toHaveBeenLastCalledWith(
      "S1",
      expect.objectContaining({ currentItemId: "a", currentSlideIndex: 2 }),
    );

    controller.itemNext();
    expect(journal.save).toHaveBeenCalledTimes(2);
    expect(journal.save).toHaveBeenLastCalledWith(
      "S1",
      expect.objectContaining({ currentItemId: "b", currentSlideIndex: 0 }),
    );
  });

  it("records the overlay stack and a heartbeat", async () => {
    await start();
    controller.overlayPush(2);
    expect(journal.save).toHaveBeenLastCalledWith(
      "S1",
      expect.objectContaining({
        overlayStack: [
          expect.objectContaining({ itemId: "verse", slideIndex: 0 }),
        ],
      }),
    );
    const before = journal.save.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(journal.save.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("demo playlist", () => {
  it("has more than 20 slides and shares one background across a song", () => {
    const items = buildDemoPlaylist({
      churchName: "Grace",
      logoSrc: null,
      testMedia: [],
    });
    const total = items.reduce((sum, item) => sum + item.doc.slides.length, 0);
    expect(total).toBeGreaterThan(20);
    const song = items.find((item) => item.kind === "song")!;
    expect(
      new Set(song.doc.slides.map((s) => JSON.stringify(s.background))).size,
    ).toBe(1);
  });
});

function engineState(patch: Partial<EngineState>): EngineState {
  return {
    lastSeq: 1,
    docId: null,
    slideId: null,
    slideIndex: 0,
    slideCount: 0,
    overlayDepth: 0,
    mask: "none",
    cleared: false,
    testPattern: false,
    video: null,
    warnings: [],
    ...patch,
  };
}

describe("live edits", () => {
  function withSlides(item: PlaylistItem, texts: string[]): PlaylistItem {
    return {
      ...item,
      doc: engineDocumentSchema.parse({
        ...item.doc,
        slides: texts.map((text, i) => ({
          id: `${item.id}-${i}`,
          background: { type: "color", value: "#000000" },
          objects: [
            {
              id: "t",
              type: "text",
              frame: { x: 0, y: 0, w: 10, h: 10 },
              content: text,
            },
          ],
        })),
      }),
    };
  }

  it("patches only changed slides of the item on screen and bumps its revision", async () => {
    await start();
    const item = withSlides(doc("a", 3), ["one", "two", "three"]);
    controller.replaceItemDocument("a", item.doc);
    audience.commands = [];
    const edited = withSlides(doc("a", 3), ["one", "TWO", "three"]);
    expect(controller.replaceItemDocument("a", edited.doc)).toEqual({
      patched: 1,
      reloaded: false,
    });
    expect(audience.commands).toEqual([
      { type: "patch", slideId: "a-1", slide: edited.doc.slides[1] },
    ]);
    expect(controller.state().items[0]!.revision).toBe(2);
  });

  it("reloads at the nearest slide when the structure changes, keeping overlays", async () => {
    await start();
    controller.goto(2);
    controller.overlayPush(2);
    audience.commands = [];
    const shorter = withSlides(doc("a", 1), ["only"]);
    expect(controller.replaceItemDocument("a", shorter.doc).reloaded).toBe(
      true,
    );
    expect(controller.state().slideIndex).toBe(0);
    expect(audience.commands.map((c) => c.type)).toEqual([
      "load",
      "clear",
      "overlay:push",
    ]);
  });

  it("an item that is not on screen just updates quietly", async () => {
    await start();
    audience.commands = [];
    expect(
      controller.replaceItemDocument(
        "b",
        withSlides(doc("b", 2), ["x", "y"]).doc,
      ),
    ).toEqual({ patched: 0, reloaded: false });
    expect(audience.commands).toEqual([]);
    expect(controller.document(1).slides[0]!.id).toBe("b-0");
  });

  it("appends items and refuses duplicates", async () => {
    await start();
    controller.appendItem({ ...doc("song:1", 2), songId: "1" });
    expect(controller.itemsForSong("1")).toEqual(["song:1"]);
    expect(() => controller.appendItem(doc("song:1", 1))).toThrow(
      /already in the playlist/,
    );
  });
});
