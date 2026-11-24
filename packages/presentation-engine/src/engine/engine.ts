import {
  parseEngineDocument,
  type EngineCommand,
  type EngineConfig,
  type EngineDocument,
  type EngineState,
  type EngineVideoState,
  type EngineWarning,
  type MaskMode,
  type TransitionSpec,
  type VideoAction,
} from "../protocol";
import { Deck, safePlay } from "./deck";
import { createElement, FILL } from "./dom";
import type { RenderContext } from "./render";
import { registerFonts } from "./fonts";
import { formatCountdown } from "./render";
import { createTestPattern } from "./test-pattern";

export interface EngineOptions {
  /**
   * - `output`: the audience window — sound on, no cursor.
   * - `preview`: operator mirror — identical picture, always muted.
   * - `static`: thumbnails — videos show their first frame and never play.
   */
  mode?: "output" | "preview" | "static";
  /** Max wait for an image decode / video first frame before swapping. */
  mediaTimeoutMs?: number;
  onState?: (state: EngineState) => void;
}

export interface PresentationEngine {
  /** Applies a command. Commands with `seq <= lastSeq` are dropped. */
  apply(command: EngineCommand): Promise<void>;
  getState(): EngineState;
  /** Recomputes the output scale (also automatic on resize). */
  relayout(): void;
  destroy(): void;
}

const DEFAULT_CONFIG: EngineConfig = {
  fallbackBackground: { type: "color", value: "#000000" },
  logoSrc: null,
  logoText: null,
  safeAreaPct: 5,
  defaultTransition: { type: "fade", ms: 300 },
};

/** Commands that never wait behind slide rendering (BLACK must be instant). */
const INSTANT = new Set<EngineCommand["type"]>([
  "config",
  "mask",
  "clear",
  "video",
  "test-pattern",
  "timer",
  "chime",
]);
const MAX_WARNINGS = 20;
const VIDEO_STATE_THROTTLE_MS = 250;

/**
 * The React-free presentation engine (DOCUMENTATION.md §3.3). Main drives it
 * with sequence-numbered commands over a MessagePort; it renders into `root`,
 * letterboxed to the document's aspect ratio, and reports its state.
 */
export function createPresentationEngine(
  root: HTMLElement,
  options: EngineOptions = {},
): PresentationEngine {
  const doc = root.ownerDocument;
  const view = doc.defaultView!;
  const mode = options.mode ?? "output";

  let config = DEFAULT_CONFIG;
  let lastSeq = 0;
  let mask: MaskMode = "none";
  let cleared = false;
  let testPatternOn = false;
  let timerEndsAt: number | null = null;
  let timerInterval: ReturnType<typeof setInterval> | undefined;

  /** Countdown clocks show the shared timer, or their own duration. */
  function tickCountdowns(): void {
    const now = Date.now();
    viewport.querySelectorAll<HTMLElement>("[data-cmp-countdown]").forEach((element) => {
      const remaining = timerEndsAt === null ? Number(element.dataset["cmpCountdown"]) : timerEndsAt - now;
      const text = formatCountdown(remaining);
      if (element.textContent !== text) element.textContent = text;
    });
  }
  const warnings: EngineWarning[] = [];

  // ── DOM ───────────────────────────────────────────────────────────────────
  const viewport = createElement(
    doc,
    "div",
    {
      position: mode === "output" ? "fixed" : "absolute",
      inset: "0",
      overflow: "hidden",
      background: "#000",
      cursor: mode === "output" ? "none" : "default",
      userSelect: "none",
    },
    { cmpEngine: mode },
  );
  const deckHost = createElement(doc, "div", FILL);
  const patternHost = createElement(doc, "div", { ...FILL, display: "none" });
  const maskLayer = createElement(
    doc,
    "div",
    {
      ...FILL,
      display: "none",
      background: "#000",
      alignItems: "center",
      justifyContent: "center",
    },
    { cmpMask: "none" },
  );
  viewport.append(deckHost, patternHost, maskLayer);
  root.replaceChildren(viewport);

  const context: RenderContext = {
    doc,
    mode,
    mediaTimeoutMs: options.mediaTimeoutMs ?? 2000,
    onMediaError: handleMediaError,
  };
  const decks: Deck[] = [newDeck()];
  const top = () => decks[decks.length - 1]!;

  // ── Output scaling (OutputController) ─────────────────────────────────────
  function relayout(): void {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    for (const deck of decks) {
      if (!deck.doc) continue;
      const scale = Math.min(width / deck.doc.width, height / deck.doc.height);
      const x = (width - deck.doc.width * scale) / 2;
      const y = (height - deck.doc.height * scale) / 2;
      deck.element.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
    if (testPatternOn) renderTestPattern();
  }
  const resizeObserver =
    typeof view.ResizeObserver === "function"
      ? new view.ResizeObserver(() => relayout())
      : null;
  resizeObserver?.observe(viewport);
  view.addEventListener("resize", relayout);

  // ── State ─────────────────────────────────────────────────────────────────
  let emitScheduled = false;
  let lastVideoEmit = 0;
  function scheduleEmit(): void {
    if (emitScheduled || !options.onState) return;
    emitScheduled = true;
    queueMicrotask(() => {
      emitScheduled = false;
      options.onState?.(getState());
    });
  }
  const onVideoEvent = (event: Event) => {
    if (event.type === "timeupdate") {
      const now = Date.now();
      if (now - lastVideoEmit < VIDEO_STATE_THROTTLE_MS) return;
      lastVideoEmit = now;
    }
    scheduleEmit();
  };
  // Media events do not bubble, so listen in the capture phase.
  for (const type of [
    "timeupdate",
    "play",
    "pause",
    "volumechange",
    "ended",
    "loadedmetadata",
  ]) {
    viewport.addEventListener(type, onVideoEvent, true);
  }

  function getState(): EngineState {
    const deck = top();
    return {
      lastSeq,
      docId: deck.doc?.id ?? null,
      slideId: deck.slide?.id ?? null,
      slideIndex: deck.index,
      slideCount: deck.doc?.slides.length ?? 0,
      overlayDepth: decks.length - 1,
      mask,
      cleared,
      testPattern: testPatternOn,
      video: videoState(),
      warnings: [...warnings],
    };
  }

  function videoState(): EngineVideoState | null {
    const video = top().activeVideo;
    if (!video) return null;
    return {
      src: video.dataset["cmpSrc"] ?? "",
      timeMs: Math.round(video.currentTime * 1000),
      durationMs: Number.isFinite(video.duration)
        ? Math.round(video.duration * 1000)
        : null,
      paused: video.paused,
      muted: video.muted,
      volume: video.volume,
    };
  }

  function warn(warning: EngineWarning): void {
    warnings.push(warning);
    if (warnings.length > MAX_WARNINGS) warnings.shift();
    scheduleEmit();
  }

  // ── Failure handling (MediaResolver fallback) ─────────────────────────────
  function handleMediaError(element: HTMLElement, src: string): void {
    warn({ code: "MEDIA_FAILED", message: "Media could not be loaded", src });
    if (element.dataset["cmpMedia"] === "background") {
      // The audience sees the fallback colour, never a broken-image icon.
      const fallback = createElement(
        doc,
        "div",
        {
          ...FILL,
          background: config.fallbackBackground.value,
        },
        { cmpFallback: "" },
      );
      element.replaceWith(fallback);
    } else {
      element.style.visibility = "hidden";
    }
  }

  // ── Commands ──────────────────────────────────────────────────────────────
  const queue: EngineCommand[] = [];
  let draining: Promise<void> | null = null;

  function apply(command: EngineCommand): Promise<void> {
    if (!Number.isFinite(command.seq) || command.seq <= lastSeq) {
      return draining ?? Promise.resolve();
    }
    lastSeq = command.seq;
    // Video transport is instant too, unless slide work is pending: then it
    // must apply to the video that work is about to put on screen (replay
    // sends load → seek).
    const instant =
      INSTANT.has(command.type) &&
      (command.type !== "video" || (queue.length === 0 && draining === null));
    if (instant) {
      applyInstant(command);
      scheduleEmit();
      return Promise.resolve();
    }
    queue.push(command);
    draining ??= drain().finally(() => {
      draining = null;
    });
    return draining;
  }

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      const command = queue.shift()!;
      // Coalesce: a goto followed by another goto/load is already stale, so
      // mashing "next" never builds a backlog.
      const following = queue[0]?.type;
      if (
        command.type === "goto" &&
        (following === "goto" || following === "load")
      ) {
        continue;
      }
      try {
        if (command.type === "video") applyInstant(command);
        else await applyQueued(command);
      } catch (error) {
        warn({ code: "INVALID_DOCUMENT", message: String(error) });
      }
      scheduleEmit();
      // Newly rendered countdown clocks pick up a running timer at once.
      if (timerEndsAt !== null) tickCountdowns();
    }
  }

  function applyInstant(command: EngineCommand): void {
    switch (command.type) {
      case "config":
        config = command.config;
        if (config.fonts) registerFonts(doc, config.fonts);
        if (mask === "logo") renderMask();
        if (testPatternOn) renderTestPattern();
        return;
      case "mask":
        mask = command.mask;
        renderMask();
        return;
      case "clear":
        cleared = command.on;
        decks.forEach((deck) => deck.applyCleared());
        return;
      case "timer":
        timerEndsAt = command.endsAt;
        tickCountdowns();
        clearInterval(timerInterval);
        timerInterval = command.endsAt === null ? undefined : setInterval(tickCountdowns, 250);
        return;
      case "chime":
        if (mode === "output") playChime(view);
        return;
      case "test-pattern":
        testPatternOn = command.on;
        patternHost.style.display = command.on ? "block" : "none";
        if (command.on) renderTestPattern();
        else patternHost.replaceChildren();
        return;
      case "video":
        controlVideo(command.action, command.value);
        return;
      default:
        return;
    }
  }

  async function applyQueued(command: EngineCommand): Promise<void> {
    switch (command.type) {
      case "load": {
        const parsed = parseEngineDocument(command.doc);
        if (!parsed.success) {
          warn({ code: "INVALID_DOCUMENT", message: parsed.error });
          return;
        }
        // A new item replaces any overlays above it.
        while (decks.length > 1) decks.pop()!.destroy();
        const base = top();
        base.element.style.visibility = "";
        base.setDocument(parsed.doc);
        relayout();
        const start = clampIndex(command.startSlide, parsed.doc);
        await base.show(start, transitionFor(parsed.doc, start));
        return;
      }
      case "goto": {
        const deck = top();
        if (!deck.doc) return;
        if (!inRange(command.slideIndex, deck.doc)) {
          warn({
            code: "OUT_OF_RANGE",
            message: `Slide ${command.slideIndex} is outside 0–${deck.doc.slides.length - 1}`,
          });
          return;
        }
        await deck.show(
          command.slideIndex,
          command.transition ?? transitionFor(deck.doc, command.slideIndex),
        );
        return;
      }
      case "patch": {
        for (let level = decks.length - 1; level >= 0; level -= 1) {
          const deck = decks[level]!;
          if (!deck.patch(command.slideId, command.slide)) continue;
          // Live edit of the visible slide: swap text in place, keep video.
          if (deck.slide?.id === command.slideId) await deck.refresh();
          return;
        }
        return;
      }
      case "overlay:push": {
        const parsed = parseEngineDocument(command.doc);
        if (!parsed.success) {
          warn({ code: "INVALID_DOCUMENT", message: parsed.error });
          return;
        }
        const below = top();
        const overlay = newDeck();
        overlay.setDocument(parsed.doc);
        decks.push(overlay);
        relayout();
        const start = clampIndex(command.startSlide, parsed.doc);
        await overlay.show(start, { type: "cut", ms: 0 });
        below.suspend();
        return;
      }
      case "overlay:pop": {
        if (decks.length <= 1) return;
        decks.pop()!.destroy();
        top().resume();
        return;
      }
      case "unload": {
        while (decks.length > 0) decks.pop()!.destroy();
        decks.push(newDeck());
        return;
      }
      default:
        return;
    }
  }

  function controlVideo(action: VideoAction, value: number | undefined): void {
    const video = top().activeVideo;
    if (!video) return;
    switch (action) {
      case "play":
        safePlay(video);
        return;
      case "pause":
        video.pause();
        return;
      case "toggle":
        if (video.paused) safePlay(video);
        else video.pause();
        return;
      case "stop":
        video.pause();
        video.currentTime = 0;
        return;
      case "seek":
        if (value !== undefined && value >= 0) video.currentTime = value / 1000;
        return;
      case "volume":
        if (value !== undefined) video.volume = Math.min(1, Math.max(0, value));
        return;
      case "mute":
        // Preview engines stay muted whatever the operator does.
        if (mode !== "output") return;
        video.muted = value === undefined ? !video.muted : value !== 0;
        return;
    }
  }

  function renderMask(): void {
    maskLayer.dataset["cmpMask"] = mask;
    maskLayer.replaceChildren();
    maskLayer.style.display = mask === "none" ? "none" : "flex";
    if (mask !== "logo") return;
    if (config.logoSrc) {
      const logo = createElement(
        doc,
        "img",
        {
          maxWidth: "40%",
          maxHeight: "40%",
          objectFit: "contain",
        },
        { cmpLogo: "" },
      );
      logo.alt = "";
      logo.addEventListener(
        "error",
        () => {
          logo.remove();
          warn({
            code: "MEDIA_FAILED",
            message: "Logo could not be loaded",
            src: config.logoSrc ?? "",
          });
        },
        { once: true },
      );
      logo.src = config.logoSrc;
      maskLayer.append(logo);
    } else if (config.logoText) {
      const text = createElement(
        doc,
        "div",
        {
          color: "#fff",
          font: "600 6vmin/1.2 Inter, system-ui, sans-serif",
          textAlign: "center",
          padding: "0 10%",
        },
        { cmpLogo: "" },
      );
      text.textContent = config.logoText;
      maskLayer.append(text);
    }
  }

  function renderTestPattern(): void {
    patternHost.replaceChildren(
      createTestPattern(doc, config.safeAreaPct, () => {
        const deck = top();
        const content = deck.doc
          ? ` · content ${deck.doc.width}×${deck.doc.height}`
          : "";
        return `output ${viewport.clientWidth}×${viewport.clientHeight} px · scale ${view.devicePixelRatio}x${content} · safe area ${config.safeAreaPct}%`;
      }),
    );
  }

  function transitionFor(
    document: EngineDocument,
    index: number,
  ): TransitionSpec {
    return document.slides[index]?.transition ?? config.defaultTransition;
  }

  function newDeck(): Deck {
    const deck = new Deck(context, () => cleared);
    deckHost.append(deck.element);
    return deck;
  }

  return {
    apply,
    getState,
    relayout,
    destroy() {
      clearInterval(timerInterval);
      resizeObserver?.disconnect();
      view.removeEventListener("resize", relayout);
      while (decks.length > 0) decks.pop()!.destroy();
      viewport.remove();
    },
  };
}

function inRange(index: number, doc: EngineDocument): boolean {
  return Number.isInteger(index) && index >= 0 && index < doc.slides.length;
}

function clampIndex(index: number, doc: EngineDocument): number {
  if (!Number.isInteger(index)) return 0;
  return Math.min(Math.max(index, 0), doc.slides.length - 1);
}

/** Three soft rising tones (Web Audio, no asset needed). */
function playChime(view: Window): void {
  const AudioContextClass = (view as Window & { AudioContext?: typeof AudioContext }).AudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    [659.25, 783.99, 1046.5].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.35;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 1.3);
    });
    setTimeout(() => void context.close(), 2500);
  } catch {
    // No audio device: the countdown still completes.
  }
}
