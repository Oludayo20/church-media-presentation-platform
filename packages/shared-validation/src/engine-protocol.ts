/**
 * The engine's wire protocol (docs/DOCUMENTATION.md §2.4, §3.3): the
 * `EngineDocument` format, the sequence-numbered `EngineCommand`s main sends
 * to every engine instance, and the `EngineState` they report back.
 *
 * A shared contract: the main process builds documents and commands with it,
 * the engine (`@cmp/presentation-engine`) validates and renders them, and the
 * IPC registry uses the document schema. DOM-free and React-free.
 */
import { z } from "zod";

export const ENGINE_DOCUMENT_SCHEMA_VERSION = "cmp.presentation/v1";

// ── Media sources ────────────────────────────────────────────────────────────

const ASSET_URL = /^cmp-media:\/\/asset\/[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Engines only load workspace media (`cmp-media://asset/<ulid>`) or inline
 * images. Anything else — http(s), file:, javascript: — is rejected when a
 * document is loaded, so a document can never make the projector fetch from
 * the network or read arbitrary files.
 */
export const mediaSrcSchema = z
  .string()
  .refine((src) => ASSET_URL.test(src), "Must be a cmp-media://asset URL");
const imageSrcSchema = z
  .string()
  .refine(
    (src) =>
      ASSET_URL.test(src) || /^data:image\/(png|jpeg|webp|gif);/.test(src),
    "Must be a cmp-media://asset URL or an inline image",
  );

const colorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);

// ── Document ─────────────────────────────────────────────────────────────────

export const transitionSchema = z.object({
  type: z.enum(["cut", "fade"]),
  ms: z.int().min(0).max(5000),
});
export type TransitionSpec = z.infer<typeof transitionSchema>;

const mediaBackgroundEffects = {
  blur: z.number().min(0).max(40).optional(),
  overlay: z.number().min(0).max(1).optional(),
};

export const backgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), value: colorSchema }),
  z.object({
    type: z.literal("gradient"),
    angle: z.number().min(0).max(360).default(180),
    stops: z.array(colorSchema).min(2).max(6),
  }),
  z.object({
    type: z.literal("image"),
    src: imageSrcSchema,
    fit: z.enum(["cover", "contain"]).default("cover"),
    ...mediaBackgroundEffects,
  }),
  z.object({
    type: z.literal("video"),
    src: mediaSrcSchema,
    loop: z.boolean().default(true),
    muted: z.boolean().default(true),
    fit: z.enum(["cover", "contain"]).default("cover"),
    ...mediaBackgroundEffects,
  }),
  z.object({ type: z.literal("transparent") }),
]);
export type Background = z.infer<typeof backgroundSchema>;

const frameSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type Frame = z.infer<typeof frameSchema>;

export const textStyleSchema = z.object({
  fontFamily: z.string().max(200).default("Inter, system-ui, sans-serif"),
  fontSize: z.number().min(4).max(800).default(72),
  fontWeight: z.int().min(100).max(900).default(600),
  color: colorSchema.default("#ffffff"),
  align: z.enum(["left", "center", "right"]).default("center"),
  vAlign: z.enum(["top", "middle", "bottom"]).default("middle"),
  lineHeight: z.number().min(0.5).max(4).default(1.2),
  letterSpacing: z.number().min(-20).max(100).default(0),
  /** CSS text-shadow, restricted to safe characters. */
  shadow: z
    .string()
    .regex(/^[\w\s#.,()%-]*$/)
    .max(200)
    .optional(),
  outline: z
    .object({ width: z.number().min(0).max(40), color: colorSchema })
    .optional(),
  /** Shrink the font until the text fits its frame. */
  autoFit: z.boolean().default(true),
});

export const slideObjectSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("text"),
    frame: frameSchema,
    content: z.string().max(10_000),
    style: textStyleSchema.default(textStyleSchema.parse({})),
    /** Reference/footer lines (scripture, copyright) survive `clear`. */
    role: z.enum(["body", "footer"]).default("body"),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("image"),
    frame: frameSchema,
    src: imageSrcSchema,
    fit: z.enum(["cover", "contain"]).default("contain"),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("video"),
    frame: frameSchema,
    src: mediaSrcSchema,
    loop: z.boolean().default(false),
    muted: z.boolean().default(false),
    autoplay: z.boolean().default(true),
    fit: z.enum(["cover", "contain"]).default("contain"),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("shape"),
    frame: frameSchema,
    fill: colorSchema,
    radius: z.number().min(0).default(0),
  }),
  /**
   * Countdown clock (§8.4). Shows `durationMs` until a `timer` command
   * starts it; then every engine computes the remaining time from the
   * shared wall-clock `endsAt`, so it is drift-free and survives reloads.
   */
  z.object({
    id: z.string().min(1),
    type: z.literal("countdown"),
    frame: frameSchema,
    durationMs: z.int().min(0).max(24 * 3600 * 1000),
    style: textStyleSchema.default(textStyleSchema.parse({})),
  }),
]);
export type SlideObject = z.infer<typeof slideObjectSchema>;
export type TextObject = Extract<SlideObject, { type: "text" }>;

export const engineSlideSchema = z.object({
  id: z.string().min(1),
  background: backgroundSchema,
  objects: z.array(slideObjectSchema).max(200),
  transition: transitionSchema.optional(),
  /** Auto-advance after this many ms (announcements). */
  durationMs: z.int().positive().optional(),
  /**
   * Producer metadata the engine ignores, e.g. a song slide's section label
   * so the operator's thumbnail strip can group "Chorus" (§5.2 step 5).
   */
  meta: z
    .record(z.string().max(40), z.union([z.string().max(200), z.number()]))
    .optional(),
});
export type EngineSlide = z.infer<typeof engineSlideSchema>;

export const engineDocumentSchema = z.object({
  schemaVersion: z.literal(ENGINE_DOCUMENT_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string(),
  width: z.int().min(320).max(7680),
  height: z.int().min(240).max(4320),
  slides: z.array(engineSlideSchema).min(1).max(2000),
});
export type EngineDocument = z.infer<typeof engineDocumentSchema>;
/** What producers write; defaults are filled in by `parseEngineDocument`. */
export type EngineDocumentInput = z.input<typeof engineDocumentSchema>;

// ── Commands ─────────────────────────────────────────────────────────────────

export const VIDEO_ACTIONS = [
  "play",
  "pause",
  "toggle",
  "stop",
  "seek",
  "volume",
  "mute",
] as const;
export type VideoAction = (typeof VIDEO_ACTIONS)[number];

export type MaskMode = "none" | "black" | "logo";

export interface EngineConfig {
  /** Shown instead of media that fails to load. */
  fallbackBackground: { type: "color"; value: string };
  /** The logo screen's image, or null for a plain black logo screen. */
  logoSrc: string | null;
  /** Text shown on the logo screen when there is no logo. */
  logoText: string | null;
  /** Safe-area inset guide, % of each edge (test pattern). */
  safeAreaPct: number;
  defaultTransition: TransitionSpec;
  /** Imported, licensed fonts to register with FontFace (Phase 7). */
  fonts?: { family: string; src: string }[];
}

/**
 * Commands without their sequence number. `load`, `overlay:push` and
 * `patch` carry already-validated documents; engines still re-validate them
 * because the renderer must not trust its input.
 */
export type EngineCommandBody =
  | { type: "config"; config: EngineConfig }
  | { type: "load"; doc: EngineDocumentInput; startSlide: number }
  | { type: "goto"; slideIndex: number; transition?: TransitionSpec }
  | { type: "patch"; slideId: string; slide: z.input<typeof engineSlideSchema> }
  | { type: "mask"; mask: MaskMode }
  | { type: "clear"; on: boolean }
  | { type: "video"; action: VideoAction; value?: number }
  | {
      type: "overlay:push";
      doc: EngineDocumentInput;
      startSlide: number;
    }
  | { type: "overlay:pop" }
  | { type: "test-pattern"; on: boolean }
  | { type: "unload" }
  /** Starts (or stops, with null) every countdown clock on screen. */
  | { type: "timer"; endsAt: number | null }
  /** A short chime on the audience output (countdown reached zero). */
  | { type: "chime" };

export type EngineCommand = EngineCommandBody & { seq: number };

// ── State reported back ──────────────────────────────────────────────────────

export interface EngineVideoState {
  src: string;
  timeMs: number;
  durationMs: number | null;
  paused: boolean;
  muted: boolean;
  volume: number;
}

export interface EngineWarning {
  code: "MEDIA_FAILED" | "INVALID_DOCUMENT" | "OUT_OF_RANGE";
  message: string;
  src?: string;
}

export interface EngineState {
  lastSeq: number;
  docId: string | null;
  slideId: string | null;
  slideIndex: number;
  slideCount: number;
  overlayDepth: number;
  mask: MaskMode;
  cleared: boolean;
  testPattern: boolean;
  /** The video the transport controls (foreground first, else background). */
  video: EngineVideoState | null;
  warnings: EngineWarning[];
}

/** Messages on the engine port, engine → main. */
export type EngineMessage =
  { type: "state"; state: EngineState } | { type: "replay" };

export function parseEngineDocument(
  input: unknown,
): { success: true; doc: EngineDocument } | { success: false; error: string } {
  const parsed = engineDocumentSchema.safeParse(migrateDocument(input));
  return parsed.success
    ? { success: true, doc: parsed.data }
    : { success: false, error: z.prettifyError(parsed.error) };
}

/**
 * Schema-version migration hook. Only v1 exists; when v2 arrives, documents
 * saved as v1 (presentation_versions, .cmppres) are upgraded here.
 */
function migrateDocument(input: unknown): unknown {
  return input;
}
