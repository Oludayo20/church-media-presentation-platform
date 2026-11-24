import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engineDocumentSchema, type EngineCommandBody } from "@cmp/shared-validation";
import { silentLogger } from "../../logging/logger";
import { LiveSessionController, type EngineSink, type PlaylistItem } from "../live-session";

function item(id: string, count: number, extra: Partial<PlaylistItem> = {}, durationMs?: number): PlaylistItem {
  return {
    id,
    title: id,
    kind: "announcement",
    doc: engineDocumentSchema.parse({
      schemaVersion: "cmp.presentation/v1",
      id,
      title: id,
      width: 1920,
      height: 1080,
      slides: Array.from({ length: count }, (_, i) => ({
        id: `${id}-${i}`,
        background: { type: "color", value: "#000000" },
        objects: [],
        ...(durationMs ? { durationMs } : {}),
      })),
    }),
    ...extra,
  };
}

const countdown = (onComplete: "next_item" | "hold" | "logo", chime = true): PlaylistItem =>
  item("countdown", 1, { kind: "countdown", auto: { kind: "countdown", durationMs: 60_000, onComplete, chime } });
const announcements = (loop = true) => item("notices", 3, { auto: { kind: "rotate", loop } }, 5000);

let controller: LiveSessionController;
let sent: EngineCommandBody[];
const sink: EngineSink = { id: "audience", send: (command) => sent.push(command) };
const types = () => sent.map((c) => c.type);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-29T08:50:00Z"));
  sent = [];
  controller = new LiveSessionController({
    loadPlaylist: async () => [],
    engineConfig: async () => ({
      fallbackBackground: { type: "color", value: "#000" },
      logoSrc: null,
      logoText: null,
      safeAreaPct: 5,
      defaultTransition: { type: "cut", ms: 0 },
    }),
    journal: () => null,
    displayProfileId: () => null,
    onState: () => {},
    logger: silentLogger,
  });
  await controller.addSink(sink, { primary: true });
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

const start = (items: PlaylistItem[], problems: { code: string; message: string }[] = []) =>
  controller.start({ output: "display", service: { id: "svc1", title: "Sunday Service", items, problems } });

describe("countdown items", () => {
  it("broadcasts a wall-clock end time, chimes, and moves to the next item at zero", async () => {
    await start([countdown("next_item"), item("welcome", 1)]);
    const endsAt = Date.parse("2026-11-29T08:51:00Z");
    expect(sent).toContainEqual({ type: "timer", endsAt });
    expect(controller.state()).toMatchObject({ timer: { endsAt, itemIndex: 0 }, service: { id: "svc1", title: "Sunday Service" } });

    sent = [];
    vi.advanceTimersByTime(59_999);
    expect(controller.state().itemIndex).toBe(0);
    vi.advanceTimersByTime(1);
    expect(types()).toContain("chime");
    expect(controller.state()).toMatchObject({ itemIndex: 1, timer: null });
    expect(sent).toContainEqual({ type: "timer", endsAt: null });
  });

  it("keeps running when the operator looks away and back, and does not act while away", async () => {
    await start([countdown("next_item"), item("welcome", 1)]);
    vi.advanceTimersByTime(20_000);
    controller.itemNext();
    vi.advanceTimersByTime(50_000); // passes zero while away: no chime, no jump
    expect(controller.state().itemIndex).toBe(1);
    sent = [];
    controller.itemPrev();
    expect(sent).toContainEqual({ type: "timer", endsAt: Date.parse("2026-11-29T08:51:00Z") });
  });

  it("logo and hold completions", async () => {
    await start([countdown("logo", false), item("welcome", 1)]);
    vi.advanceTimersByTime(60_000);
    expect(controller.state()).toMatchObject({ mask: "logo", itemIndex: 0 });
    expect(types()).not.toContain("chime");
    await controller.end();

    await start([countdown("hold"), item("welcome", 1)]);
    vi.advanceTimersByTime(60_000);
    expect(controller.state()).toMatchObject({ mask: "none", itemIndex: 0 });
  });

  it("restart sets a fresh end time; reconnecting engines get the timer", async () => {
    await start([countdown("hold"), item("welcome", 1)]);
    vi.advanceTimersByTime(30_000);
    expect(controller.restartCountdown().timer?.endsAt).toBe(Date.now() + 60_000);
    const replayed: EngineCommandBody[] = [];
    await controller.addSink({ id: "mirror", send: (command) => replayed.push(command) });
    expect(replayed).toContainEqual({ type: "timer", endsAt: Date.now() + 60_000 });
    controller.itemNext();
    expect(() => controller.restartCountdown()).toThrow(/not a countdown/);
  });
});

describe("announcement rotation", () => {
  it("rotates and loops back to the first slide", async () => {
    await start([announcements()]);
    expect(controller.state().rotation).toEqual({ durationMs: 5000, paused: false });
    vi.advanceTimersByTime(5000);
    expect(controller.state().slideIndex).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(controller.state().slideIndex).toBe(0); // looped
  });

  it("pauses on any manual command until resumed", async () => {
    await start([announcements()]);
    controller.next();
    expect(controller.state()).toMatchObject({ slideIndex: 1, rotation: { paused: true } });
    vi.advanceTimersByTime(30_000);
    expect(controller.state().slideIndex).toBe(1);
    controller.resumeRotation();
    vi.advanceTimersByTime(5000);
    expect(controller.state()).toMatchObject({ slideIndex: 2, rotation: { paused: false } });
  });

  it("without loop, moves on to the next item after the last slide; a new item starts unpaused", async () => {
    await start([announcements(false), announcements(true)].map((entry, i) => ({ ...entry, id: `n${i}` })));
    controller.goto(1); // manual → paused
    controller.itemNext();
    expect(controller.state()).toMatchObject({ itemIndex: 1, rotation: { paused: false } });
    controller.itemPrev();
    controller.resumeRotation();
    vi.advanceTimersByTime(15_000);
    expect(controller.state().itemIndex).toBe(1);
  });
});

describe("service sessions", () => {
  it("shows skipped items as warnings", async () => {
    const state = await start([item("welcome", 1)], [{ code: "ITEM_SKIPPED", message: "Skipped “Opening song”: Choose a song" }]);
    expect(state.warnings).toEqual([{ code: "ITEM_SKIPPED", message: "Skipped “Opening song”: Choose a song" }]);
  });
});
