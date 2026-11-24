import { posix } from "node:path";
import type { ZipArchive } from "../zip";
import {
  at,
  attr,
  child,
  children,
  kids,
  num,
  parseXml,
  root,
  tagOf,
  textOf,
  type XNode,
} from "./xml";

/**
 * PowerPoint (.pptx) → an intermediate deck model (docs/TASKS.md Phase 7):
 * text boxes, images, video, simple shapes, backgrounds and fade
 * transitions. Everything that cannot be represented is counted in the
 * conversion report instead of silently disappearing.
 *
 * Runs in the utility worker (SECURITY.md: parsers never run in main).
 */

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PptxBackground =
  | { type: "color"; value: string }
  | { type: "gradient"; angle: number; stops: string[] }
  | { type: "image"; media: string };

export type PptxObject =
  | {
      kind: "text";
      frame: Frame;
      content: string;
      style: {
        fontFamily: string;
        fontSize: number;
        fontWeight: number;
        color: string;
        align: "left" | "center" | "right";
        vAlign: "top" | "middle" | "bottom";
        lineHeight: number;
      };
    }
  | { kind: "image"; frame: Frame; media: string }
  | { kind: "video"; frame: Frame; media: string }
  | { kind: "shape"; frame: Frame; fill: string; radius: number };

export interface PptxSlide {
  background: PptxBackground;
  objects: PptxObject[];
  transition: { type: "cut" | "fade"; ms: number };
}

export interface PptxReport {
  /** What could not be imported, by kind, with counts. */
  dropped: Record<string, number>;
}

export interface PptxDeck {
  title: string;
  width: number;
  height: number;
  slides: PptxSlide[];
  /** Zip paths of every media file the slides reference. */
  media: string[];
  report: PptxReport;
}

export const PPTX_LIMITS = {
  maxXmlBytes: 20 * 1024 * 1024,
  maxSlides: 500,
} as const;

const SUPPORTED_IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const SUPPORTED_VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const PRESET_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  gray: "#808080",
};

interface Rel {
  target: string;
  external: boolean;
  type: string;
}

interface Part {
  path: string;
  xml: XNode;
  rels: Map<string, Rel>;
}

interface Theme {
  colors: Record<string, string>;
  majorFont: string;
  minorFont: string;
}

interface Context {
  zip: ZipArchive;
  signal: AbortSignal | undefined;
  parts: Map<string, Promise<Part | null>>;
  report: PptxReport;
  media: Set<string>;
  /** EMU → document px. */
  scale: number;
}

interface SlideChain {
  slide: Part;
  layout: Part | null;
  master: Part | null;
  theme: Theme;
  clrMap: Record<string, string>;
  defaultTextStyle: XNode | undefined;
}

function drop(report: PptxReport, kind: string, count = 1): void {
  report.dropped[kind] = (report.dropped[kind] ?? 0) + count;
}

// ── Parts and relationships ──────────────────────────────────────────────────

async function readXml(ctx: Context, path: string): Promise<XNode[] | null> {
  if (!ctx.zip.has(path)) return null;
  const bytes = await ctx.zip.read(path, PPTX_LIMITS.maxXmlBytes, ctx.signal);
  return parseXml(bytes.toString("utf8"));
}

function relsPath(path: string): string {
  return posix.join(
    posix.dirname(path),
    "_rels",
    `${posix.basename(path)}.rels`,
  );
}

/** Resolves a relationship target against its part, inside the package. */
function resolveTarget(base: string, target: string): string {
  const joined = target.startsWith("/")
    ? target.slice(1)
    : posix.join(posix.dirname(base), target);
  return posix.normalize(joined).replace(/^(\.\.\/)+/, "");
}

async function loadRels(ctx: Context, path: string): Promise<Map<string, Rel>> {
  const rels = new Map<string, Rel>();
  const nodes = await readXml(ctx, relsPath(path));
  const top = nodes ? root(nodes, "Relationships") : undefined;
  for (const rel of children(top, "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (!id || !target) continue;
    const external = attr(rel, "TargetMode") === "External";
    rels.set(id, {
      target: external ? target : resolveTarget(path, target),
      external,
      type: attr(rel, "Type") ?? "",
    });
  }
  return rels;
}

function loadPart(
  ctx: Context,
  path: string,
  rootName: string,
): Promise<Part | null> {
  const key = `${path}#${rootName}`;
  let part = ctx.parts.get(key);
  if (!part) {
    part = (async () => {
      const nodes = await readXml(ctx, path);
      const xml = nodes ? root(nodes, rootName) : undefined;
      if (!xml) return null;
      return { path, xml, rels: await loadRels(ctx, path) };
    })();
    ctx.parts.set(key, part);
  }
  return part;
}

function relOfType(part: Part | null, suffix: string): Rel | undefined {
  return part
    ? [...part.rels.values()].find((rel) => rel.type.endsWith(suffix))
    : undefined;
}

async function loadTheme(ctx: Context, master: Part | null): Promise<Theme> {
  const theme: Theme = {
    colors: {},
    majorFont: "Calibri",
    minorFont: "Calibri",
  };
  const rel = relOfType(master, "/theme");
  const part = rel ? await loadPart(ctx, rel.target, "a:theme") : null;
  const elements = at(part?.xml, "a:themeElements");
  for (const entry of kids(at(elements, "a:clrScheme"))) {
    const name = tagOf(entry)?.replace(/^a:/, "");
    const swatch = kids(entry)[0];
    if (!name || !swatch) continue;
    const tag = tagOf(swatch);
    const value =
      tag === "a:srgbClr"
        ? attr(swatch, "val")
        : tag === "a:sysClr"
          ? attr(swatch, "lastClr")
          : undefined;
    if (value) theme.colors[name] = `#${value.toUpperCase()}`;
  }
  theme.majorFont =
    attr(at(elements, "a:fontScheme", "a:majorFont", "a:latin"), "typeface") ||
    theme.majorFont;
  theme.minorFont =
    attr(at(elements, "a:fontScheme", "a:minorFont", "a:latin"), "typeface") ||
    theme.minorFont;
  return theme;
}

// ── Colours ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** Applies OOXML lumMod/lumOff (HSL lightness), the common theme tints. */
function adjust(hex: string, node: XNode): string {
  const lumMod = attr(child(node, "a:lumMod"), "val");
  const lumOff = attr(child(node, "a:lumOff"), "val");
  if (!lumMod && !lumOff) return hex;
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h =
      max === r
        ? (g - b) / d + (g < b ? 6 : 0)
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
    h /= 6;
  }
  l = Math.min(
    1,
    Math.max(0, l * (num(lumMod, 100000) / 100000) + num(lumOff, 0) / 100000),
  );
  const toRgb = (p: number, q: number, t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  if (s === 0) return rgbToHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex([
    toRgb(p, q, h + 1 / 3) * 255,
    toRgb(p, q, h) * 255,
    toRgb(p, q, h - 1 / 3) * 255,
  ]);
}

/** The colour inside a fill/colour container, resolved through the theme. */
function colorIn(
  container: XNode | undefined,
  chain: SlideChain,
): string | null {
  for (const node of kids(container)) {
    const tag = tagOf(node);
    let hex: string | null = null;
    if (tag === "a:srgbClr")
      hex = `#${(attr(node, "val") ?? "000000").toUpperCase()}`;
    else if (tag === "a:sysClr")
      hex = `#${(attr(node, "lastClr") ?? (attr(node, "val") === "windowText" ? "000000" : "FFFFFF")).toUpperCase()}`;
    else if (tag === "a:prstClr")
      hex = PRESET_COLORS[attr(node, "val") ?? ""] ?? null;
    else if (tag === "a:schemeClr") {
      const name = attr(node, "val") ?? "";
      hex = chain.theme.colors[chain.clrMap[name] ?? name] ?? null;
    }
    if (!hex) continue;
    hex = adjust(hex, node);
    const alpha = attr(child(node, "a:alpha"), "val");
    if (alpha && num(alpha, 100000) < 100000) {
      hex += Math.round((num(alpha) / 100000) * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();
    }
    return hex;
  }
  return null;
}

type Fill =
  | { type: "none" }
  | { type: "color"; value: string }
  | { type: "gradient"; angle: number; stops: string[] }
  | { type: "image"; media: string | null };

/** The explicit fill of a `spPr`/`bgPr`, or undefined to inherit. */
function fillOf(
  node: XNode | undefined,
  chain: SlideChain,
  part: Part,
): Fill | undefined {
  if (child(node, "a:noFill")) return { type: "none" };
  const solid = child(node, "a:solidFill");
  if (solid) {
    const value = colorIn(solid, chain);
    return value ? { type: "color", value } : undefined;
  }
  const gradient = child(node, "a:gradFill");
  if (gradient) {
    const stops = children(at(gradient, "a:gsLst"), "a:gs")
      .sort((a, b) => num(attr(a, "pos")) - num(attr(b, "pos")))
      .map((stop) => colorIn(stop, chain))
      .filter((color): color is string => color !== null)
      .slice(0, 6);
    const angle =
      (num(attr(child(gradient, "a:lin"), "ang")) / 60000 + 90) % 360;
    if (stops.length >= 2) return { type: "gradient", angle, stops };
    if (stops.length === 1) return { type: "color", value: stops[0]! };
    return undefined;
  }
  const blip = child(node, "a:blipFill");
  if (blip) {
    const embed = attr(child(blip, "a:blip"), "r:embed");
    const rel = embed ? part.rels.get(embed) : undefined;
    return { type: "image", media: rel && !rel.external ? rel.target : null };
  }
  return undefined;
}

// ── Placeholders and text styles ────────────────────────────────────────────

type PhKind = "title" | "body" | "other";

function placeholder(
  sp: XNode,
): { type: string; idx: string | undefined } | null {
  const ph =
    at(sp, "p:nvSpPr", "p:nvPr", "p:ph") ??
    at(sp, "p:nvPicPr", "p:nvPr", "p:ph");
  if (!ph) return null;
  return { type: attr(ph, "type") ?? "body", idx: attr(ph, "idx") };
}

function phKind(type: string): PhKind {
  if (type === "title" || type === "ctrTitle") return "title";
  if (type === "body" || type === "subTitle" || type === "obj") return "body";
  return "other";
}

/** The matching placeholder shape in a layout or master. */
function findPlaceholder(
  part: Part | null,
  ph: { type: string; idx: string | undefined },
  byIdx: boolean,
): XNode | undefined {
  const tree = at(part?.xml, "p:cSld", "p:spTree");
  const shapes = children(tree, "p:sp");
  if (byIdx && ph.idx !== undefined) {
    const match = shapes.find((sp) => placeholder(sp)?.idx === ph.idx);
    if (match) return match;
  }
  return shapes.find((sp) => {
    const candidate = placeholder(sp);
    return (
      candidate &&
      phKind(candidate.type) === phKind(ph.type) &&
      (phKind(ph.type) !== "other" || candidate.type === ph.type)
    );
  });
}

function xfrmOf(sp: XNode | undefined): Frame | null {
  const xfrm = at(sp, "p:spPr", "a:xfrm") ?? at(sp, "p:xfrm");
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  if (!off || !ext) return null;
  return {
    x: num(attr(off, "x")),
    y: num(attr(off, "y")),
    w: num(attr(ext, "cx")),
    h: num(attr(ext, "cy")),
  };
}

function levelOf(node: XNode | undefined, level: number): XNode | undefined {
  return child(node, `a:lvl${level + 1}pPr`);
}

interface TextProps {
  size?: number;
  bold?: boolean;
  color?: string;
  font?: string;
  align?: string;
  bullet?: string | null;
}

/** Reads the props a `lvlNpPr`/`pPr` (+ its `defRPr`) or an `rPr` sets. */
function propsOf(
  node: XNode | undefined,
  chain: SlideChain,
  isRun: boolean,
): TextProps {
  if (!node) return {};
  const rPr = isRun ? node : child(node, "a:defRPr");
  const props: TextProps = {};
  if (attr(rPr, "sz")) props.size = num(attr(rPr, "sz"));
  if (attr(rPr, "b") !== undefined)
    props.bold = attr(rPr, "b") === "1" || attr(rPr, "b") === "true";
  const color = colorIn(child(rPr, "a:solidFill"), chain);
  if (color) props.color = color;
  const font = attr(child(rPr, "a:latin"), "typeface");
  if (font) props.font = font;
  if (!isRun) {
    const align = attr(node, "algn");
    if (align) props.align = align;
    if (child(node, "a:buNone")) props.bullet = null;
    else if (child(node, "a:buChar"))
      props.bullet = attr(child(node, "a:buChar"), "char") ?? "•";
    else if (child(node, "a:buAutoNum")) props.bullet = "•";
  }
  return props;
}

/** First defined value of each prop, highest priority first. */
function merge(layers: TextProps[]): TextProps {
  const result: TextProps = {};
  for (const layer of layers) {
    for (const key of Object.keys(layer) as (keyof TextProps)[]) {
      if (result[key] === undefined && layer[key] !== undefined)
        (result as Record<string, unknown>)[key] = layer[key];
    }
  }
  return result;
}

// ── Shapes ───────────────────────────────────────────────────────────────────

type Mapper = (frame: Frame) => Frame;

interface Walk {
  ctx: Context;
  chain: SlideChain;
  objects: PptxObject[];
}

function toPx(frame: Frame, scale: number): Frame {
  return {
    x: Math.round(frame.x * scale),
    y: Math.round(frame.y * scale),
    w: Math.max(1, Math.round(frame.w * scale)),
    h: Math.max(1, Math.round(frame.h * scale)),
  };
}

function walkTree(tree: XNode | undefined, map: Mapper, walk: Walk): void {
  for (const node of kids(tree)) {
    switch (tagOf(node)) {
      case "p:sp":
        shape(node, map, walk);
        break;
      case "p:pic":
        picture(node, map, walk);
        break;
      case "p:grpSp":
        group(node, map, walk);
        break;
      case "p:graphicFrame": {
        const uri = attr(at(node, "a:graphic", "a:graphicData"), "uri") ?? "";
        drop(
          walk.ctx.report,
          uri.includes("table")
            ? "Table"
            : uri.includes("chart")
              ? "Chart"
              : uri.includes("diagram")
                ? "SmartArt diagram"
                : "Embedded object",
        );
        break;
      }
      case "p:cxnSp":
        drop(walk.ctx.report, "Line or connector");
        break;
      case "mc:AlternateContent":
        // Newer features with a compatible fallback: use the fallback.
        walkTree(child(node, "mc:Fallback"), map, walk);
        break;
      default:
        break;
    }
  }
}

function group(node: XNode, map: Mapper, walk: Walk): void {
  const xfrm = at(node, "p:grpSpPr", "a:xfrm");
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  const chOff = child(xfrm, "a:chOff");
  const chExt = child(xfrm, "a:chExt");
  if (!off || !ext || !chOff || !chExt) {
    walkTree(node, map, walk);
    return;
  }
  const sx = num(attr(chExt, "cx"))
    ? num(attr(ext, "cx")) / num(attr(chExt, "cx"))
    : 1;
  const sy = num(attr(chExt, "cy"))
    ? num(attr(ext, "cy")) / num(attr(chExt, "cy"))
    : 1;
  const inner: Mapper = (frame) =>
    map({
      x: num(attr(off, "x")) + (frame.x - num(attr(chOff, "x"))) * sx,
      y: num(attr(off, "y")) + (frame.y - num(attr(chOff, "y"))) * sy,
      w: frame.w * sx,
      h: frame.h * sy,
    });
  walkTree(node, inner, walk);
}

function picture(node: XNode, map: Mapper, walk: Walk): void {
  const { ctx, chain } = walk;
  const frame = xfrmOf(node) ?? xfrmOf(findPlaceholderFor(node, chain));
  if (!frame) return;
  // Video: <a:videoFile r:link> or <p14:media r:embed> (in nvPr's extLst).
  const nvPr = at(node, "p:nvPicPr", "p:nvPr");
  const videoLink = attr(child(nvPr, "a:videoFile"), "r:link");
  const p14 = children(at(nvPr, "p:extLst"), "p:ext")
    .map((ext) => child(ext, "p14:media"))
    .find(Boolean);
  const videoRel =
    (p14 && chain.slide.rels.get(attr(p14, "r:embed") ?? "")) ??
    (videoLink ? chain.slide.rels.get(videoLink) : undefined);
  if (videoRel || child(nvPr, "a:audioFile")) {
    if (!videoRel || child(nvPr, "a:audioFile")) {
      drop(ctx.report, "Audio clip");
      return;
    }
    if (videoRel.external) {
      drop(ctx.report, "Linked (not embedded) video");
      return;
    }
    if (!SUPPORTED_VIDEO.test(videoRel.target)) {
      drop(ctx.report, "Video in an unsupported format");
      return;
    }
    ctx.media.add(videoRel.target);
    walk.objects.push({
      kind: "video",
      frame: toPx(map(frame), ctx.scale),
      media: videoRel.target,
    });
    return;
  }
  const embed = attr(at(node, "p:blipFill", "a:blip"), "r:embed");
  const rel = embed ? chain.slide.rels.get(embed) : undefined;
  if (!rel || rel.external) {
    drop(ctx.report, "Linked (not embedded) picture");
    return;
  }
  if (!SUPPORTED_IMAGE.test(rel.target)) {
    drop(
      ctx.report,
      `Picture in ${posix.extname(rel.target).slice(1).toUpperCase() || "an unknown"} format`,
    );
    return;
  }
  if (at(node, "p:blipFill", "a:srcRect")) {
    const crop = at(node, "p:blipFill", "a:srcRect");
    if (["l", "t", "r", "b"].some((side) => num(attr(crop, side)) !== 0))
      drop(ctx.report, "Picture crop (whole image shown)");
  }
  ctx.media.add(rel.target);
  walk.objects.push({
    kind: "image",
    frame: toPx(map(frame), ctx.scale),
    media: rel.target,
  });
}

function findPlaceholderFor(sp: XNode, chain: SlideChain): XNode | undefined {
  const ph = placeholder(sp);
  if (!ph) return undefined;
  return (
    findPlaceholder(chain.layout, ph, true) ??
    findPlaceholder(chain.master, ph, false)
  );
}

function shape(sp: XNode, map: Mapper, walk: Walk): void {
  const { ctx, chain } = walk;
  const ph = placeholder(sp);
  const layoutSp = ph ? findPlaceholder(chain.layout, ph, true) : undefined;
  const masterSp = ph ? findPlaceholder(chain.master, ph, false) : undefined;
  const rawFrame = xfrmOf(sp) ?? xfrmOf(layoutSp) ?? xfrmOf(masterSp);
  if (!rawFrame) return;
  const frame = toPx(map(rawFrame), ctx.scale);

  // Fill (explicit, else the shape style's fillRef for drawn shapes).
  const spPr = child(sp, "p:spPr");
  const geometry =
    attr(child(spPr, "a:prstGeom"), "prst") ??
    (child(spPr, "a:custGeom") ? "custom" : "rect");
  let fill = fillOf(spPr, chain, chain.slide);
  const isTextBox = attr(at(sp, "p:nvSpPr", "p:cNvSpPr"), "txBox") === "1";
  if (!fill && !ph && !isTextBox) {
    const fillRef = at(sp, "p:style", "a:fillRef");
    const color =
      num(attr(fillRef, "idx")) > 0 ? colorIn(fillRef, chain) : null;
    if (color) fill = { type: "color", value: color };
  }

  const text = textObject(sp, frame, ph, layoutSp, masterSp, walk);
  const drawable = fill && fill.type !== "none";
  if (drawable) {
    if (!["rect", "roundRect", "ellipse", "snipRect"].includes(geometry)) {
      drop(
        ctx.report,
        text ? "Shape outline (text kept)" : `Shape (${geometry})`,
      );
    } else if (fill!.type === "image") {
      drop(ctx.report, "Picture-filled shape");
    } else {
      if (fill!.type === "gradient")
        drop(ctx.report, "Gradient shape fill (first colour used)");
      const color =
        fill!.type === "color"
          ? fill!.value
          : fill!.type === "gradient"
            ? fill!.stops[0]!
            : "#000000";
      const radius =
        geometry === "ellipse"
          ? Math.min(frame.w, frame.h) / 2
          : geometry === "roundRect"
            ? Math.min(frame.w, frame.h) * 0.1667
            : 0;
      walk.objects.push({
        kind: "shape",
        frame,
        fill: color,
        radius: Math.round(radius),
      });
    }
  }
  if (text) walk.objects.push(text);
}

function textObject(
  sp: XNode,
  frame: Frame,
  ph: { type: string; idx: string | undefined } | null,
  layoutSp: XNode | undefined,
  masterSp: XNode | undefined,
  walk: Walk,
): PptxObject | null {
  const { ctx, chain } = walk;
  const body = child(sp, "p:txBody");
  if (!body) return null;
  const kind = ph ? phKind(ph.type) : null;
  const masterStyles = at(chain.master?.xml, "p:txStyles");
  const masterStyle =
    kind === "title"
      ? child(masterStyles, "p:titleStyle")
      : kind === "body"
        ? child(masterStyles, "p:bodyStyle")
        : kind === "other"
          ? child(masterStyles, "p:otherStyle")
          : undefined;
  const listStyles = [
    child(body, "a:lstStyle"),
    at(layoutSp, "p:txBody", "a:lstStyle"),
    at(masterSp, "p:txBody", "a:lstStyle"),
    masterStyle,
    ph ? undefined : chain.defaultTextStyle,
  ];

  const bodyPr = [
    child(body, "a:bodyPr"),
    at(layoutSp, "p:txBody", "a:bodyPr"),
    at(masterSp, "p:txBody", "a:bodyPr"),
  ];
  const anchor =
    bodyPr.map((node) => attr(node, "anchor")).find(Boolean) ?? "t";
  const fontScale =
    num(
      attr(child(child(body, "a:bodyPr"), "a:normAutofit"), "fontScale"),
      100000,
    ) / 100000;

  const lines: string[] = [];
  const runs: TextProps[] = [];
  let firstParagraph: TextProps | null = null;

  for (const paragraph of children(body, "a:p")) {
    const pPr = child(paragraph, "a:pPr");
    const level = Math.min(8, num(attr(pPr, "lvl")));
    const paragraphProps = merge([
      propsOf(pPr, chain, false),
      ...listStyles.map((style) =>
        propsOf(levelOf(style, level), chain, false),
      ),
    ]);
    let line = "";
    for (const node of kids(paragraph)) {
      const tag = tagOf(node);
      if (tag === "a:br") {
        line += "\n";
      } else if (tag === "a:r" || tag === "a:fld") {
        const value = textOf(child(node, "a:t"));
        if (value.trim())
          runs.push(
            merge([propsOf(child(node, "a:rPr"), chain, true), paragraphProps]),
          );
        line += value;
      }
    }
    if (line.trim() && !firstParagraph) firstParagraph = paragraphProps;
    const bullet =
      line.trim() && kind !== "title" ? paragraphProps.bullet : null;
    lines.push(bullet ? `${bullet} ${line}` : line);
  }
  while (lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop();
  while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
  const content = lines.join("\n");
  if (!content.trim()) return null;

  const first = runs[0] ?? firstParagraph ?? {};
  const differs = runs.some(
    (run) =>
      run.size !== first.size ||
      run.color !== first.color ||
      run.bold !== first.bold,
  );
  if (differs) drop(ctx.report, "Mixed text formatting (simplified)");

  const typeface = first.font ?? "+mn-lt";
  const family =
    typeface === "+mj-lt"
      ? chain.theme.majorFont
      : typeface.startsWith("+")
        ? chain.theme.minorFont
        : typeface;
  const sizePt = (first.size ?? (kind === "title" ? 4400 : 1800)) / 100;
  const align = firstParagraph?.align ?? "l";
  return {
    kind: "text",
    frame,
    content,
    style: {
      fontFamily: `"${family.replace(/["\\]/g, "")}", Inter, system-ui, sans-serif`,
      fontSize: Math.max(
        4,
        Math.min(800, Math.round(sizePt * 12700 * ctx.scale * fontScale)),
      ),
      fontWeight: first.bold ? 700 : 400,
      color: (
        first.color ??
        chain.theme.colors[chain.clrMap["tx1"] ?? "dk1"] ??
        "#000000"
      ).slice(0, 9),
      align: align === "ctr" ? "center" : align === "r" ? "right" : "left",
      vAlign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
      lineHeight: 1.15,
    },
  };
}

// ── Backgrounds and transitions ─────────────────────────────────────────────

function background(chain: SlideChain): PptxBackground {
  for (const part of [chain.slide, chain.layout, chain.master]) {
    const bg = at(part?.xml, "p:cSld", "p:bg");
    if (!part || !bg) continue;
    const bgPr = child(bg, "p:bgPr");
    if (bgPr) {
      const fill = fillOf(bgPr, chain, part);
      if (fill?.type === "color") return { type: "color", value: fill.value };
      if (fill?.type === "gradient")
        return { type: "gradient", angle: fill.angle, stops: fill.stops };
      if (
        fill?.type === "image" &&
        fill.media &&
        SUPPORTED_IMAGE.test(fill.media)
      )
        return { type: "image", media: fill.media };
      continue;
    }
    const color = colorIn(child(bg, "p:bgRef"), chain);
    if (color) return { type: "color", value: color };
  }
  return {
    type: "color",
    value: chain.theme.colors[chain.clrMap["bg1"] ?? "lt1"] ?? "#FFFFFF",
  };
}

function transitionOf(
  slide: XNode,
  report: PptxReport,
): PptxSlide["transition"] {
  const node =
    child(slide, "p:transition") ??
    at(slide, "mc:AlternateContent", "mc:Fallback", "p:transition") ??
    at(slide, "mc:AlternateContent", "mc:Choice", "p:transition");
  if (!node) return { type: "cut", ms: 0 };
  const effect = kids(node)
    .map(tagOf)
    .find((tag) => tag && tag !== "p:sndAc" && tag !== "p:extLst");
  const speed = attr(node, "spd");
  const ms = num(
    attr(node, "p14:dur"),
    speed === "fast" ? 500 : speed === "slow" ? 1000 : 700,
  );
  if (effect === "p:fade" || effect === "p:dissolve")
    return { type: "fade", ms: Math.min(5000, ms) };
  if (effect) drop(report, "Slide transition (simplified to cut)");
  return { type: "cut", ms: 0 };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function parsePptx(
  zip: ZipArchive,
  options: { fileName: string; signal?: AbortSignal },
): Promise<PptxDeck> {
  const report: PptxReport = { dropped: {} };
  const ctx: Context = {
    zip,
    signal: options.signal,
    parts: new Map(),
    report,
    media: new Set(),
    scale: 1,
  };
  const presentation = await loadPart(
    ctx,
    "ppt/presentation.xml",
    "p:presentation",
  );
  if (!presentation) throw new Error("This is not a PowerPoint (.pptx) file");

  const size = child(presentation.xml, "p:sldSz");
  const cx = num(attr(size, "cx"), 12192000);
  const cy = num(attr(size, "cy"), 6858000);
  const height = 1080;
  const width = Math.min(7680, Math.max(320, Math.round((height * cx) / cy)));
  ctx.scale = height / cy;
  const defaultTextStyle = child(presentation.xml, "p:defaultTextStyle");

  const slideRefs = children(child(presentation.xml, "p:sldIdLst"), "p:sldId")
    .map((node) => presentation.rels.get(attr(node, "r:id") ?? ""))
    .filter((rel): rel is Rel => Boolean(rel && !rel.external));
  if (slideRefs.length > PPTX_LIMITS.maxSlides)
    throw new Error(
      `Presentations over ${PPTX_LIMITS.maxSlides} slides are not supported`,
    );

  const slides: PptxSlide[] = [];
  for (const ref of slideRefs) {
    options.signal?.throwIfAborted();
    const slide = await loadPart(ctx, ref.target, "p:sld");
    if (!slide) continue;
    if (attr(slide.xml, "show") === "0") {
      drop(report, "Hidden slide (skipped)");
      continue;
    }
    const layoutRel = relOfType(slide, "/slideLayout");
    const layout = layoutRel
      ? await loadPart(ctx, layoutRel.target, "p:sldLayout")
      : null;
    const masterRel = relOfType(layout, "/slideMaster");
    const master = masterRel
      ? await loadPart(ctx, masterRel.target, "p:sldMaster")
      : null;
    const theme = await loadTheme(ctx, master);
    const clrMapNode = child(master?.xml, "p:clrMap");
    const clrMap = Object.fromEntries(
      Object.entries(
        (clrMapNode?.[":@"] as Record<string, string> | undefined) ?? {
          bg1: "lt1",
          tx1: "dk1",
          bg2: "lt2",
          tx2: "dk2",
        },
      ),
    );
    const chain: SlideChain = {
      slide,
      layout,
      master,
      theme,
      clrMap,
      defaultTextStyle,
    };

    const objects: PptxObject[] = [];
    walkTree(at(slide.xml, "p:cSld", "p:spTree"), (frame) => frame, {
      ctx,
      chain,
      objects,
    });
    if (child(slide.xml, "p:timing")) drop(report, "Animations (removed)");
    if (relOfType(slide, "/notesSlide"))
      drop(report, "Speaker notes (not imported)");
    slides.push({
      background: background(chain),
      objects,
      transition: transitionOf(slide.xml, report),
    });

    const bg = slides[slides.length - 1]!.background;
    if (bg.type === "image") ctx.media.add(bg.media);
  }
  if (slides.length === 0)
    throw new Error("The presentation has no slides to import");

  const core = await readXml(ctx, "docProps/core.xml").catch(() => null);
  const title = textOf(
    at(core ? root(core, "cp:coreProperties") : undefined, "dc:title"),
  ).trim();
  return {
    title: (
      title ||
      options.fileName.replace(/\.pptx$/i, "") ||
      "Imported presentation"
    ).slice(0, 300),
    width,
    height,
    slides,
    media: [...ctx.media],
    report,
  };
}
