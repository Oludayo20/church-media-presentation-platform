/**
 * Tiny DOM helpers. All styling goes through the CSSOM (`element.style.x`):
 * the strict CSP forbids inline <style> elements and style attributes in
 * markup, but CSSOM writes are allowed.
 */
export type Styles = Partial<Record<keyof CSSStyleDeclaration, string>>;

export function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  styles: Styles = {},
  dataset: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  Object.assign(element.style, styles);
  Object.assign(element.dataset, dataset);
  return element;
}

export const FILL: Styles = {
  position: "absolute",
  left: "0",
  top: "0",
  width: "100%",
  height: "100%",
};

export type MediaReadiness = "ready" | "error" | "timeout";

/**
 * Resolves when an <img> is decoded or a <video> has its first frame, or
 * reports an error, or gives up after `timeoutMs` (the slide is shown anyway
 * and fills in when the media arrives).
 */
export function waitForMedia(
  media: HTMLImageElement | HTMLVideoElement,
  timeoutMs: number,
): Promise<MediaReadiness> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: MediaReadiness) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      media.removeEventListener("error", onError);
      media.removeEventListener(readyEvent, onReady);
      resolve(result);
    };
    const onError = () => finish("error");
    const onReady = () => finish("ready");
    const isVideo =
      media instanceof media.ownerDocument.defaultView!.HTMLVideoElement;
    const readyEvent = isVideo ? "loadeddata" : "load";
    const timer = setTimeout(() => finish("timeout"), timeoutMs);

    media.addEventListener("error", onError);
    media.addEventListener(readyEvent, onReady);

    if (isVideo) {
      if ((media as HTMLVideoElement).readyState >= 2) finish("ready");
      return;
    }
    const image = media as HTMLImageElement;
    if (image.complete && image.naturalWidth > 0) finish("ready");
    else if (typeof image.decode === "function") {
      image.decode().then(
        () => finish("ready"),
        () => {
          // decode() also rejects when the src changes; only a real load
          // error (the listener above) counts as failure.
        },
      );
    }
  });
}

/** Stops a media element and releases its decoder. */
export function releaseMedia(root: ParentNode): void {
  root.querySelectorAll("video").forEach((video) => {
    video.pause();
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      // jsdom does not implement load().
    }
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
