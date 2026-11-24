import { AppError } from "@cmp/shared-types";
import type {
  LiveOutput,
  LiveState,
  LiveStatus,
  PlaylistItemKind,
} from "@cmp/shared-types";
import type {
  EngineCommandBody,
  EngineConfig,
  EngineDocument,
  EngineState,
  EngineVideoState,
  EngineWarning,
  MaskMode,
  VideoAction,
} from "@cmp/shared-validation";
import type { LiveSessionSnapshot } from "@cmp/database";
import type { Logger } from "../logging/logger";

export interface PlaylistItem {
  id: string;
  title: string;
  kind: PlaylistItemKind;
  doc: EngineDocument;
  /** For songs: the song id, so a lyric edit can find its live item. */
  songId?: string | null;
  /**
   * Automatic behaviour (§8.4): a countdown clock with a completion action,
   * or announcement rotation that pauses on any manual command.
   */
  auto?:
    | { kind: "countdown"; durationMs: number; onComplete: "next_item" | "hold" | "logo"; chime: boolean }
    | { kind: "rotate"; loop: boolean };
}

/** An engine instance fed by this session (audience window, operator mirror). */
export interface EngineSink {
  readonly id: string;
  send(command: EngineCommandBody): void;
}

export interface LiveJournal {
  start(input: {
    serviceId: string | null;
    displayProfileId: string | null;
  }): Promise<{ id: string }>;
  save(id: string, snapshot: LiveSessionSnapshot): Promise<void>;
  end(id: string): Promise<string>;
}

export interface LiveSessionDeps {
  loadPlaylist(): Promise<PlaylistItem[]>;
  engineConfig(): Promise<EngineConfig>;
  journal(): LiveJournal | null;
  displayProfileId(): string | null;
  onState(state: LiveState): void;
  logger: Logger;
  journalDebounceMs?: number;
  heartbeatMs?: number;
}

interface Overlay {
  item: PlaylistItem;
  itemIndex: number;
  slideIndex: number;
  /** Video position underneath when the overlay was pushed. */
  snapshot: EngineVideoState | null;
}

interface Session {
  id: string;
  items: PlaylistItem[];
  itemIndex: number;
  slideIndex: number;
  mask: MaskMode;
  cleared: boolean;
  overlays: Overlay[];
  output: LiveOutput;
  video: EngineVideoState | null;
  warnings: EngineWarning[];
  /** Items that could not be resolved when the service started. */
  problems: { code: string; message: string }[];
  service: { id: string; title: string } | null;
  /** Countdown end times by item id (wall clock), kept across item changes. */
  countdownEnds: Map<string, number>;
  countdownDone: Set<string>;
  rotationPaused: boolean;
}

/**
 * The live session (DOCUMENTATION.md §3.1). It owns the authoritative model;
 * engines only render what it tells them. The status is derived:
 *
 *   ended/none → idle · output disconnected → suspended · overlay → overlay ·
 *   mask → masked · otherwise live
 *
 * so leaving `suspended` (or popping an overlay, or unblanking) always lands
 * in the correct previous state without extra bookkeeping.
 */
export class LiveSessionController {
  private session: Session | null = null;
  private preparing = false;
  private testPatternOn = false;
  private config: EngineConfig | null = null;
  private readonly sinks = new Map<string, EngineSink>();
  private primarySinkId: string | null = null;
  private readonly revisions = new Map<string, number>();
  private saveTimer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private autoAdvance: NodeJS.Timeout | null = null;
  private autoAdvanceKey: string | null = null;
  private countdownTimer: NodeJS.Timeout | null = null;
  /** Last `timer` broadcast, so unchanged values are not re-sent. */
  private lastTimer: number | null | undefined = undefined;
  private readonly debounceMs: number;

  constructor(private readonly deps: LiveSessionDeps) {
    this.debounceMs = deps.journalDebounceMs ?? 250;
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get active(): boolean {
    return this.session !== null;
  }

  get testPattern(): boolean {
    return this.testPatternOn;
  }

  state(): LiveState {
    const session = this.session;
    const overlay = session?.overlays.at(-1) ?? null;
    return {
      status: this.status(),
      sessionId: session?.id ?? null,
      output: session?.output ?? "display",
      mask: session?.mask ?? "none",
      cleared: session?.cleared ?? false,
      testPattern: this.testPatternOn,
      itemIndex: session?.itemIndex ?? 0,
      slideIndex: session?.slideIndex ?? 0,
      items: (session?.items ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        slideCount: item.doc.slides.length,
        revision: this.revisions.get(item.id) ?? 0,
        songId: item.songId ?? null,
      })),
      overlay: overlay
        ? {
            depth: session!.overlays.length,
            kind: overlay.item.kind,
            title: overlay.item.title,
            itemIndex: overlay.itemIndex,
            slideIndex: overlay.slideIndex,
            slideCount: overlay.item.doc.slides.length,
          }
        : null,
      video: session?.video
        ? {
            timeMs: session.video.timeMs,
            durationMs: session.video.durationMs,
            paused: session.video.paused,
            muted: session.video.muted,
            volume: session.video.volume,
          }
        : null,
      warnings: [
        ...(session?.problems ?? []),
        ...(session?.warnings ?? []).map(({ code, message }) => ({ code, message })),
      ],
      service: session?.service ?? null,
      timer: this.timerState(),
      rotation: this.rotationState(),
    };
  }

  private timerState(): LiveState["timer"] {
    const session = this.session;
    const item = session && this.currentItem(session);
    const endsAt = item ? session.countdownEnds.get(item.id) : undefined;
    return item?.auto?.kind === "countdown" && endsAt !== undefined ? { endsAt, itemIndex: session!.itemIndex } : null;
  }

  private rotationState(): LiveState["rotation"] {
    const session = this.session;
    const item = session && this.currentItem(session);
    if (item?.auto?.kind !== "rotate") return null;
    const durationMs = item.doc.slides[session!.slideIndex]?.durationMs ?? 0;
    return { durationMs, paused: session!.rotationPaused };
  }

  private status(): LiveStatus {
    const session = this.session;
    if (this.preparing) return "preparing";
    if (!session) return "idle";
    if (session.output === "disconnected") return "suspended";
    if (session.overlays.length > 0) return "overlay";
    if (session.mask !== "none") return "masked";
    return "live";
  }

  document(itemIndex: number): EngineDocument {
    const item = this.session?.items[itemIndex];
    if (!item) throw new AppError("NOT_FOUND", "No such playlist item");
    return item.doc;
  }

  // ── Sinks ─────────────────────────────────────────────────────────────────

  /** Adds an engine and brings it up to date (journal replay). */
  async addSink(
    sink: EngineSink,
    options: { primary?: boolean } = {},
  ): Promise<void> {
    this.sinks.set(sink.id, sink);
    if (options.primary) this.primarySinkId = sink.id;
    await this.replay(sink);
  }

  removeSink(id: string): void {
    this.sinks.delete(id);
    if (this.primarySinkId === id) this.primarySinkId = null;
  }

  /** Which engine's reports (video time, warnings) the session trusts. */
  setPrimarySink(id: string | null): void {
    this.primarySinkId = id;
  }

  async replay(sink: EngineSink): Promise<void> {
    sink.send({ type: "config", config: await this.ensureConfig() });
    sink.send({ type: "test-pattern", on: this.testPatternOn });
    const session = this.session;
    if (!session) {
      sink.send({ type: "unload" });
      return;
    }
    const item = session.items[session.itemIndex]!;
    sink.send({ type: "load", doc: item.doc, startSlide: session.slideIndex });
    // Restore the base item's video to where the audience last saw it.
    const baseVideo =
      session.overlays[0]?.snapshot ??
      (session.overlays.length === 0 ? session.video : null);
    if (baseVideo && baseVideo.timeMs > 0) {
      sink.send({ type: "video", action: "seek", value: baseVideo.timeMs });
    }
    if (baseVideo?.paused) sink.send({ type: "video", action: "pause" });
    sink.send({ type: "timer", endsAt: this.timerState()?.endsAt ?? null });
    sink.send({ type: "mask", mask: session.mask });
    sink.send({ type: "clear", on: session.cleared });
    for (const overlay of session.overlays) {
      sink.send({
        type: "overlay:push",
        doc: overlay.item.doc,
        startSlide: overlay.slideIndex,
      });
    }
  }

  /** Engine reports arrive here; only the primary engine's are used. */
  handleEngineState(sinkId: string, engine: EngineState): void {
    const session = this.session;
    if (!session || sinkId !== this.primarySinkId) return;
    const before = JSON.stringify([session.video, session.warnings.length]);
    session.video = engine.video;
    session.warnings = engine.warnings;
    if (JSON.stringify([session.video, session.warnings.length]) !== before) {
      this.changed();
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(input: {
    output: LiveOutput;
    startAt?: { itemIndex: number; slideIndex: number } | undefined;
    /** A resolved service; without it the default playlist is loaded. */
    service?: { id: string; title: string; items: PlaylistItem[]; problems: { code: string; message: string }[] };
  }): Promise<LiveState> {
    if (this.session || this.preparing) {
      throw new AppError(
        "LIVE_SESSION_ACTIVE",
        "A live session is already running",
      );
    }
    this.preparing = true;
    this.publish();
    try {
      const [items, config] = await Promise.all([
        input.service ? Promise.resolve(input.service.items) : this.deps.loadPlaylist(),
        this.deps.engineConfig(),
      ]);
      if (items.length === 0)
        throw new AppError("NOT_FOUND", "Nothing to present");
      this.config = config;
      const itemIndex = clamp(input.startAt?.itemIndex ?? 0, items.length);
      const slideIndex = clamp(
        input.startAt?.slideIndex ?? 0,
        items[itemIndex]!.doc.slides.length,
      );
      const journal = this.deps.journal();
      const record = journal
        ? await journal.start({
            serviceId: input.service?.id ?? null,
            displayProfileId: this.deps.displayProfileId(),
          })
        : { id: `session-${Date.now()}` };
      this.session = {
        id: record.id,
        items,
        itemIndex,
        slideIndex,
        mask: "none",
        cleared: false,
        overlays: [],
        output: input.output,
        video: null,
        warnings: [],
        problems: input.service?.problems ?? [],
        service: input.service ? { id: input.service.id, title: input.service.title } : null,
        countdownEnds: new Map(),
        countdownDone: new Set(),
        rotationPaused: false,
      };
    } finally {
      this.preparing = false;
    }
    this.deps.logger.info(`[live] session ${this.session.id} started`);
    this.lastTimer = null; // the replay below sends the starting timer state
    for (const sink of this.sinks.values()) await this.replay(sink);
    this.enterItem();
    this.heartbeat = setInterval(
      () => this.saveNow(),
      this.deps.heartbeatMs ?? 10_000,
    );
    this.saveNow();
    this.publish();
    return this.state();
  }

  async end(): Promise<LiveState> {
    const session = this.requireSession();
    this.clearTimers();
    this.session = null;
    this.lastTimer = undefined;
    this.broadcast({ type: "unload" });
    const journal = this.deps.journal();
    if (journal) {
      await journal
        .end(session.id)
        .catch((error: unknown) =>
          this.deps.logger.error("[live] could not close the journal", error),
        );
    }
    this.deps.logger.info(`[live] session ${session.id} ended`);
    this.publish();
    return this.state();
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /** Next slide; past the last slide of an item, the next item's first. */
  next(): LiveState {
    this.pauseRotation();
    return this.step();
  }

  /** `next` without counting as a manual command (timers). */
  private step(): LiveState {
    const session = this.requireSession();
    const overlay = session.overlays.at(-1);
    if (overlay) {
      if (overlay.slideIndex + 1 < overlay.item.doc.slides.length) {
        overlay.slideIndex += 1;
        this.broadcast({ type: "goto", slideIndex: overlay.slideIndex });
        this.changed();
      }
      return this.state();
    }
    if (session.slideIndex + 1 < this.currentItem(session).doc.slides.length) {
      return this.gotoSlide(session.slideIndex + 1);
    }
    if (session.itemIndex + 1 < session.items.length) {
      return this.loadItem(session.itemIndex + 1, 0);
    }
    return this.state();
  }

  /** Previous slide; before the first, the previous item's last slide. */
  prev(): LiveState {
    this.pauseRotation();
    const session = this.requireSession();
    const overlay = session.overlays.at(-1);
    if (overlay) {
      if (overlay.slideIndex > 0) {
        overlay.slideIndex -= 1;
        this.broadcast({ type: "goto", slideIndex: overlay.slideIndex });
        this.changed();
      }
      return this.state();
    }
    if (session.slideIndex > 0) return this.gotoSlide(session.slideIndex - 1);
    if (session.itemIndex > 0) {
      const previous = session.items[session.itemIndex - 1]!;
      return this.loadItem(
        session.itemIndex - 1,
        previous.doc.slides.length - 1,
      );
    }
    return this.state();
  }

  goto(slideIndex: number): LiveState {
    this.pauseRotation();
    const session = this.requireSession();
    const overlay = session.overlays.at(-1);
    const count = overlay
      ? overlay.item.doc.slides.length
      : this.currentItem(session).doc.slides.length;
    if (slideIndex >= count) {
      throw new AppError(
        "VALIDATION_ERROR",
        `There is no slide ${slideIndex + 1}`,
      );
    }
    if (overlay) {
      overlay.slideIndex = slideIndex;
      this.broadcast({ type: "goto", slideIndex });
      this.changed();
      return this.state();
    }
    return this.gotoSlide(slideIndex);
  }

  itemGoto(itemIndex: number): LiveState {
    const session = this.requireSession();
    if (itemIndex >= session.items.length) {
      throw new AppError(
        "VALIDATION_ERROR",
        `There is no item ${itemIndex + 1}`,
      );
    }
    return this.loadItem(itemIndex, 0);
  }

  itemNext(): LiveState {
    const session = this.requireSession();
    return session.itemIndex + 1 < session.items.length
      ? this.loadItem(session.itemIndex + 1, 0)
      : this.state();
  }

  itemPrev(): LiveState {
    const session = this.requireSession();
    return session.itemIndex > 0
      ? this.loadItem(session.itemIndex - 1, 0)
      : this.state();
  }

  // ── Masks, clear, video ───────────────────────────────────────────────────

  blank(on: boolean): LiveState {
    return this.setMask("black", on);
  }

  logo(on: boolean): LiveState {
    return this.setMask("logo", on);
  }

  clear(on: boolean): LiveState {
    const session = this.requireSession();
    session.cleared = on;
    this.broadcast({ type: "clear", on });
    this.changed();
    return this.state();
  }

  video(action: VideoAction, value?: number): LiveState {
    this.requireSession();
    this.broadcast(
      value === undefined
        ? { type: "video", action }
        : { type: "video", action, value },
    );
    return this.state();
  }

  // ── Overlays ──────────────────────────────────────────────────────────────

  /** Shows a playlist item over the current one, remembering where we were. */
  overlayPush(itemIndex: number): LiveState {
    const session = this.requireSession();
    const item = session.items[itemIndex];
    if (!item)
      throw new AppError(
        "VALIDATION_ERROR",
        `There is no item ${itemIndex + 1}`,
      );
    return this.overlayPushDocument(item, itemIndex);
  }

  overlayDocument(): EngineDocument | null {
    return this.session?.overlays.at(-1)?.item.doc ?? null;
  }

  overlayPushDocument(item: PlaylistItem, itemIndex = -1): LiveState {
    const session = this.requireSession();
    const snapshot = session.overlays.length === 0 ? session.video : null;
    session.overlays.push({ item, itemIndex, slideIndex: 0, snapshot });
    this.broadcast({ type: "overlay:push", doc: item.doc, startSlide: 0 });
    this.saveNow();
    this.changed();
    return this.state();
  }

  /** Returns to exactly the item, slide and video time underneath. */
  overlayPop(): LiveState {
    const session = this.requireSession();
    const popped = session.overlays.pop();
    if (popped) {
      this.broadcast({ type: "overlay:pop" });
      if (session.overlays.length === 0 && popped.snapshot)
        session.video = popped.snapshot;
      this.saveNow();
      this.changed();
    }
    return this.state();
  }

  // ── Output ────────────────────────────────────────────────────────────────

  setOutput(output: LiveOutput): void {
    if (!this.session || this.session.output === output) return;
    this.session.output = output;
    this.deps.logger.info(`[live] output → ${output}`);
    this.saveNow();
    this.publish();
  }

  setTestPattern(on: boolean): LiveState {
    this.testPatternOn = on;
    this.broadcast({ type: "test-pattern", on });
    this.publish();
    return this.state();
  }

  /** Settings changed (logo, fallback, transition): re-send the config. */
  async refreshConfig(): Promise<void> {
    this.config = await this.deps.engineConfig();
    this.broadcast({ type: "config", config: this.config });
  }

  // ── Playlist changes ──────────────────────────────────────────────────────

  /** Appends an item to the running session (a queued song). */
  appendItem(item: PlaylistItem): LiveState {
    const session = this.requireSession();
    if (session.items.some((existing) => existing.id === item.id)) {
      throw new AppError(
        "CONFLICT",
        `“${item.title}” is already in the playlist`,
      );
    }
    session.items.push(item);
    this.publish();
    return this.state();
  }

  /** Ids of items showing this song (for live lyric edits). */
  itemsForSong(songId: string): string[] {
    return (this.session?.items ?? [])
      .filter((item) => item.songId === songId)
      .map((item) => item.id);
  }

  /**
   * Live edit (DOCUMENTATION.md §3.6): swaps an item's document. If it is on
   * screen and its slide ids are unchanged, only the changed slides are sent
   * as `patch` — the engine swaps text in place and keeps video playing.
   * Structural changes reload the item at the nearest slide.
   */
  replaceItemDocument(
    itemId: string,
    doc: EngineDocument,
  ): { patched: number; reloaded: boolean } {
    const session = this.session;
    const index = session?.items.findIndex((item) => item.id === itemId) ?? -1;
    if (!session || index < 0) return { patched: 0, reloaded: false };
    const previous = session.items[index]!.doc;
    session.items[index] = { ...session.items[index]!, doc };
    this.revisions.set(itemId, (this.revisions.get(itemId) ?? 0) + 1);
    for (const overlay of session.overlays) {
      if (overlay.item.id === itemId) overlay.item = session.items[index]!;
    }

    const sameShape =
      previous.slides.length === doc.slides.length &&
      previous.slides.every(
        (slide, position) => slide.id === doc.slides[position]!.id,
      );
    const onScreen =
      session.itemIndex === index ||
      session.overlays.some((overlay) => overlay.item.id === itemId);
    let patched = 0;
    let reloaded = false;
    if (onScreen && sameShape) {
      doc.slides.forEach((slide, position) => {
        if (
          JSON.stringify(slide) !== JSON.stringify(previous.slides[position])
        ) {
          this.broadcast({ type: "patch", slideId: slide.id, slide });
          patched += 1;
        }
      });
    } else if (onScreen && session.itemIndex === index) {
      session.slideIndex = clamp(session.slideIndex, doc.slides.length);
      this.broadcast({ type: "load", doc, startSlide: session.slideIndex });
      this.broadcast({ type: "clear", on: session.cleared });
      // `load` drops overlays in the engine: put them back as they were.
      for (const overlay of session.overlays) {
        this.broadcast({
          type: "overlay:push",
          doc: overlay.item.doc,
          startSlide: overlay.slideIndex,
        });
      }
      reloaded = true;
    } else if (onScreen) {
      const top = session.overlays.at(-1);
      if (top?.item.id === itemId) {
        top.slideIndex = clamp(top.slideIndex, doc.slides.length);
        this.broadcast({ type: "overlay:pop" });
        this.broadcast({
          type: "overlay:push",
          doc,
          startSlide: top.slideIndex,
        });
        reloaded = true;
      }
    }
    this.saveNow();
    this.publish();
    return { patched, reloaded };
  }

  /** Resumes announcement rotation after a manual command paused it. */
  resumeRotation(): LiveState {
    const session = this.requireSession();
    if (session.rotationPaused) {
      session.rotationPaused = false;
      this.publish();
    }
    return this.state();
  }

  /** Starts the current countdown again from its full duration. */
  restartCountdown(): LiveState {
    const session = this.requireSession();
    const item = this.currentItem(session);
    if (item.auto?.kind !== "countdown") throw new AppError("CONFLICT", "The current item is not a countdown");
    session.countdownEnds.delete(item.id);
    session.countdownDone.delete(item.id);
    this.enterItem();
    this.publish();
    return this.state();
  }

  dispose(): void {
    this.clearTimers();
  }

  private broadcastTimer(endsAt: number | null): void {
    if (endsAt === this.lastTimer) return;
    this.lastTimer = endsAt;
    this.broadcast({ type: "timer", endsAt });
  }

  private pauseRotation(): void {
    const session = this.session;
    if (!session || session.overlays.length > 0) return;
    if (this.currentItem(session).auto?.kind === "rotate" && !session.rotationPaused) {
      session.rotationPaused = true;
      // Cancel the step already scheduled; publish() will not reschedule
      // while paused.
      if (this.autoAdvance) clearTimeout(this.autoAdvance);
      this.autoAdvance = null;
      this.autoAdvanceKey = null;
    }
  }

  /**
   * The current item just came on screen: start (or keep) its countdown and
   * reset announcement rotation.
   */
  private enterItem(): void {
    const session = this.session;
    if (!session) return;
    const item = this.currentItem(session);
    session.rotationPaused = false;
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    if (item.auto?.kind !== "countdown") {
      this.broadcastTimer(null);
      return;
    }
    let endsAt = session.countdownEnds.get(item.id);
    if (endsAt === undefined) {
      endsAt = Date.now() + item.auto.durationMs;
      session.countdownEnds.set(item.id, endsAt);
    }
    this.broadcastTimer(endsAt);
    if (session.countdownDone.has(item.id)) return;
    const auto = item.auto;
    this.countdownTimer = setTimeout(
      () => {
        this.countdownTimer = null;
        const current = this.session;
        if (!current || this.currentItem(current).id !== item.id) return;
        current.countdownDone.add(item.id);
        if (auto.chime) this.broadcast({ type: "chime" });
        this.deps.logger.info(`[live] countdown “${item.title}” finished → ${auto.onComplete}`);
        if (auto.onComplete === "next_item") this.itemNext();
        else if (auto.onComplete === "logo") this.logo(true);
        else this.publish();
      },
      Math.max(0, Math.min(endsAt - Date.now(), 2_147_483_647)),
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private gotoSlide(slideIndex: number): LiveState {
    const session = this.requireSession();
    session.slideIndex = slideIndex;
    this.broadcast({ type: "goto", slideIndex });
    this.changed();
    return this.state();
  }

  private loadItem(itemIndex: number, slideIndex: number): LiveState {
    const session = this.requireSession();
    session.itemIndex = itemIndex;
    session.slideIndex = slideIndex;
    session.overlays = []; // a new item replaces any overlays
    session.cleared = false;
    session.video = null;
    this.broadcast({
      type: "load",
      doc: session.items[itemIndex]!.doc,
      startSlide: slideIndex,
    });
    this.broadcast({ type: "clear", on: false });
    this.enterItem();
    this.saveNow(); // item changes are flushed immediately (§9.4)
    this.publish();
    return this.state();
  }

  private setMask(mask: Exclude<MaskMode, "none">, on: boolean): LiveState {
    const session = this.requireSession();
    const next: MaskMode = on
      ? mask
      : session.mask === mask
        ? "none"
        : session.mask;
    if (next !== session.mask) {
      session.mask = next;
      this.broadcast({ type: "mask", mask: next });
      this.changed();
    }
    return this.state();
  }

  private currentItem(session: Session): PlaylistItem {
    return session.items[session.itemIndex]!;
  }

  private requireSession(): Session {
    if (!this.session)
      throw new AppError("CONFLICT", "No live session is running");
    return this.session;
  }

  private async ensureConfig(): Promise<EngineConfig> {
    this.config ??= await this.deps.engineConfig();
    return this.config;
  }

  private broadcast(command: EngineCommandBody): void {
    for (const sink of this.sinks.values()) {
      try {
        sink.send(command);
      } catch (error) {
        this.deps.logger.warn(
          `[live] could not reach engine ${sink.id}`,
          error,
        );
      }
    }
  }

  /** A change that should reach the journal (debounced) and the operator. */
  private changed(): void {
    this.scheduleSave();
    this.publish();
  }

  private publish(): void {
    this.scheduleAutoAdvance();
    this.deps.onState(this.state());
  }

  private scheduleAutoAdvance(): void {
    const session = this.session;
    const item = session && this.currentItem(session);
    const duration = item?.doc.slides[session!.slideIndex]?.durationMs;
    const key =
      session &&
      duration &&
      session.mask === "none" &&
      !session.cleared &&
      !session.overlays.length &&
      !this.testPatternOn &&
      session.output !== "disconnected" &&
      !session.rotationPaused
        ? JSON.stringify([
            session.id,
            session.itemIndex,
            session.slideIndex,
            duration,
          ])
        : null;
    if (key === this.autoAdvanceKey) return;
    if (this.autoAdvance) clearTimeout(this.autoAdvance);
    this.autoAdvance = null;
    this.autoAdvanceKey = key;
    if (key && duration)
      this.autoAdvance = setTimeout(
        () => {
          this.autoAdvance = null;
          const current = this.session;
          if (!current) return;
          const item = this.currentItem(current);
          const last = current.slideIndex + 1 >= item.doc.slides.length;
          // Announcements loop back to their first slide (§8.4).
          if (item.auto?.kind === "rotate" && last && item.auto.loop && item.doc.slides.length > 1) {
            this.gotoSlide(0);
          } else {
            this.step();
          }
        },
        Math.min(duration, 2_147_483_647),
      );
  }

  private snapshot(session: Session): LiveSessionSnapshot {
    return {
      displayProfileId: this.deps.displayProfileId(),
      currentItemId: this.currentItem(session).id,
      currentSlideIndex: session.slideIndex,
      overlayStack: session.overlays.map((overlay) => ({
        itemId: overlay.item.id,
        kind: overlay.item.kind,
        slideIndex: overlay.slideIndex,
        underneath: overlay.snapshot
          ? { timeMs: overlay.snapshot.timeMs, paused: overlay.snapshot.paused }
          : null,
      })),
      playbackState: session.video
        ? {
            src: session.video.src,
            timeMs: session.video.timeMs,
            paused: session.video.paused,
            muted: session.video.muted,
          }
        : null,
    };
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.saveNow(), this.debounceMs);
  }

  private saveNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const session = this.session;
    const journal = this.deps.journal();
    if (!session || !journal) return;
    void journal
      .save(session.id, this.snapshot(session))
      .catch((error: unknown) =>
        this.deps.logger.error("[live] journal write failed", error),
      );
  }

  private clearTimers(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.autoAdvance) clearTimeout(this.autoAdvance);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    this.autoAdvance = null;
    this.autoAdvanceKey = null;
    this.saveTimer = null;
    this.heartbeat = null;
  }
}

function clamp(index: number, length: number): number {
  return Math.min(Math.max(index, 0), Math.max(length - 1, 0));
}
