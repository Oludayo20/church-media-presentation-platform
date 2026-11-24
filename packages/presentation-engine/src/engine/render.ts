import type { Background, EngineSlide, SlideObject } from "../protocol";
import { createElement, FILL, waitForMedia, type Styles } from "./dom";

export interface RenderContext {
  doc: Document;
  /** Preview engines never play sound; static ones never play at all. */
  mode: "output" | "preview" | "static";
  mediaTimeoutMs: number;
  /** Called when media fails to load, now or later. */
  onMediaError(element: HTMLElement, src: string): void;
}

/** A stable identity for a background: equal keys mean "keep it playing". */
export function backgroundKey(background: Background): string {
  switch (background.type) {
    case "color":
      return `color:${background.value.toLowerCase()}`;
    case "gradient":
      return `gradient:${background.angle}:${background.stops.join(",")}`;
    case "image":
      return `image:${background.src}:${background.fit}:${background.blur ?? 0}:${background.overlay ?? 0}`;
    case "video":
      return `video:${background.src}:${background.fit}:${background.loop}:${background.muted}:${background.blur ?? 0}:${background.overlay ?? 0}`;
    case "transparent":
      return "transparent";
  }
}

/** Renders a slide background into `layer`, resolving once media is ready. */
export async function renderBackground(
  layer: HTMLElement,
  background: Background,
  context: RenderContext,
): Promise<void> {
  const { doc } = context;
  switch (background.type) {
    case "color":
      layer.style.background = background.value;
      return;
    case "gradient":
      layer.style.background = `linear-gradient(${background.angle}deg, ${background.stops.join(", ")})`;
      return;
    case "transparent":
      layer.style.background = "transparent";
      return;
    case "image": {
      const image = createElement(
        doc,
        "img",
        {
          ...FILL,
          objectFit: background.fit,
        },
        { cmpMedia: "background" },
      );
      image.alt = "";
      image.decoding = "async";
      watchErrors(image, background.src, context);
      image.src = background.src;
      addMediaBackground(layer, image, background);
      await settle(image, background.src, context);
      return;
    }
    case "video": {
      const video = createVideo(
        doc,
        background.src,
        {
          loop: background.loop,
          muted: background.muted,
          autoplay: true,
          fit: background.fit,
        },
        context,
      );
      video.dataset["cmpMedia"] = "background";
      Object.assign(video.style, FILL);
      addMediaBackground(layer, video, background);
      await settle(video, background.src, context);
      return;
    }
  }
}

function addMediaBackground(
  layer: HTMLElement,
  media: HTMLImageElement | HTMLVideoElement,
  options: { blur?: number | undefined; overlay?: number | undefined },
): void {
  if (options.blur) media.style.filter = `blur(${options.blur}px)`;
  layer.append(media);
  if (options.overlay) {
    const overlay = createElement(layer.ownerDocument, "div", {
      ...FILL,
      backgroundColor: `rgba(0,0,0,${options.overlay})`,
      pointerEvents: "none",
    });
    layer.append(overlay);
  }
}

/** Renders a slide's objects into `layer`, resolving once media is ready. */
export async function renderContent(
  layer: HTMLElement,
  slide: EngineSlide,
  context: RenderContext,
): Promise<void> {
  const pending: Promise<void>[] = [];
  slide.objects.forEach((object, index) => {
    const element = renderObject(object, context, pending);
    element.dataset["cmpObject"] = object.id;
    element.style.zIndex = String(index + 1);
    layer.append(element);
  });
  await Promise.all(pending);
  // Fit text only once it is in the DOM and can be measured.
  layer.querySelectorAll<HTMLElement>("[data-cmp-autofit]").forEach(fitText);
}

function renderObject(
  object: SlideObject,
  context: RenderContext,
  pending: Promise<void>[],
): HTMLElement {
  const { doc } = context;
  const frame: Styles = {
    position: "absolute",
    left: `${object.frame.x}px`,
    top: `${object.frame.y}px`,
    width: `${object.frame.w}px`,
    height: `${object.frame.h}px`,
  };

  switch (object.type) {
    case "text": {
      const { style } = object;
      const box = createElement(
        doc,
        "div",
        {
          ...frame,
          display: "flex",
          flexDirection: "column",
          justifyContent: {
            top: "flex-start",
            middle: "center",
            bottom: "flex-end",
          }[style.vAlign],
          overflow: "hidden",
        },
        { cmpRole: object.role },
      );
      const text = createElement(doc, "div", {
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSize}px`,
        fontWeight: String(style.fontWeight),
        color: style.color,
        textAlign: style.align,
        lineHeight: String(style.lineHeight),
        letterSpacing: `${style.letterSpacing}px`,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        textShadow: style.shadow ?? "",
        ...(style.outline && style.outline.width > 0
          ? {
              webkitTextStroke: `${style.outline.width}px ${style.outline.color}`,
              paintOrder: "stroke fill",
            }
          : {}),
      });
      text.textContent = object.content;
      if (style.autoFit) box.dataset["cmpAutofit"] = String(style.fontSize);
      box.append(text);
      return box;
    }
    case "image": {
      const image = createElement(doc, "img", {
        ...frame,
        objectFit: object.fit,
      });
      image.alt = "";
      image.decoding = "async";
      watchErrors(image, object.src, context);
      image.src = object.src;
      pending.push(settle(image, object.src, context));
      return image;
    }
    case "video": {
      const video = createVideo(doc, object.src, object, context);
      Object.assign(video.style, frame);
      video.dataset["cmpMedia"] = "foreground";
      pending.push(settle(video, object.src, context));
      return video;
    }
    case "shape":
      return createElement(doc, "div", {
        ...frame,
        background: object.fill,
        borderRadius: `${object.radius}px`,
      });
    case "countdown": {
      const { style } = object;
      const box = createElement(doc, "div", {
        ...frame,
        display: "flex",
        alignItems: "center",
        justifyContent: { left: "flex-start", center: "center", right: "flex-end" }[style.align],
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSize}px`,
        fontWeight: String(style.fontWeight),
        color: style.color,
        textShadow: style.shadow ?? "",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }, { cmpCountdown: String(object.durationMs), cmpRole: "body" });
      box.textContent = formatCountdown(object.durationMs);
      return box;
    }
  }
}

function createVideo(
  doc: Document,
  src: string,
  options: { loop: boolean; muted: boolean; autoplay: boolean; fit: string },
  context: RenderContext,
): HTMLVideoElement {
  const video = createElement(doc, "video", {
    objectFit: options.fit,
    background: "transparent",
  });
  video.playsInline = true;
  video.preload = context.mode === "static" ? "metadata" : "auto";
  video.loop = options.loop;
  video.muted = options.muted || context.mode !== "output";
  video.dataset["cmpAutoplay"] = String(
    options.autoplay && context.mode !== "static",
  );
  video.dataset["cmpSrc"] = src;
  watchErrors(video, src, context);
  video.src = src;
  return video;
}

function watchErrors(
  media: HTMLImageElement | HTMLVideoElement,
  src: string,
  context: RenderContext,
): void {
  media.addEventListener("error", () => context.onMediaError(media, src), {
    once: true,
  });
}

async function settle(
  media: HTMLImageElement | HTMLVideoElement,
  _src: string,
  context: RenderContext,
): Promise<void> {
  // Errors are handled by watchErrors (fallback + warning); here we only
  // wait, bounded, so a slow or broken file never blocks the swap.
  await waitForMedia(media, context.mediaTimeoutMs);
}

/** Shrinks text until it fits its frame (DOCUMENTATION.md §3.3 TextRenderer). */
export function fitText(box: HTMLElement): void {
  const text = box.firstElementChild as HTMLElement | null;
  const base = Number(box.dataset["cmpAutofit"]);
  if (!text || !Number.isFinite(base)) return;
  let size = base;
  text.style.fontSize = `${size}px`;
  const fits = () =>
    text.scrollHeight <= box.clientHeight &&
    text.scrollWidth <= box.clientWidth;
  // No layout (detached or jsdom): nothing to measure.
  if (box.clientHeight === 0) return;
  while (!fits() && size > 8) {
    size = Math.floor(size * 0.92);
    text.style.fontSize = `${size}px`;
  }
}

/** `09:58`, `10:00`, `1:05:00` — seconds rounded up so zero shows only at the end. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${String(minutes).padStart(2, "0")}:${seconds}`;
}
