import {
  engineSlideSchema,
  type EngineDocument,
  type EngineSlide,
  type TransitionSpec,
} from "../protocol";
import { createElement } from "./dom";
import { Plane } from "./plane";
import {
  backgroundKey,
  renderBackground,
  renderContent,
  type RenderContext,
} from "./render";

const CUT: TransitionSpec = { type: "cut", ms: 0 };

/**
 * One document on screen: a background plane under a content plane, each
 * double-buffered. The base presentation is one deck; every overlay
 * (Quick Scripture, media) is another deck stacked above it.
 */
export class Deck {
  readonly element: HTMLElement;
  doc: EngineDocument | null = null;
  index = -1;
  private readonly background: Plane;
  private readonly content: Plane;
  private generation = 0;
  private revisions = new Map<string, number>();
  private resumeOnShow: HTMLVideoElement[] = [];

  constructor(
    private readonly context: RenderContext,
    private readonly isCleared: () => boolean,
  ) {
    const { doc } = context;
    this.element = createElement(
      doc,
      "div",
      {
        position: "absolute",
        left: "0",
        top: "0",
        transformOrigin: "0 0",
        overflow: "hidden",
      },
      { cmpDeck: "" },
    );
    this.background = new Plane(doc, "background");
    this.content = new Plane(doc, "content");
    // Each plane is its own stacking context, so the layer z-indexes used
    // for transitions (1/2) can never lift a background above the text.
    this.background.element.style.zIndex = "0";
    this.background.element.style.isolation = "isolate";
    this.content.element.style.zIndex = "1";
    this.content.element.style.isolation = "isolate";
    this.element.append(this.background.element, this.content.element);
  }

  /** Swaps the document but keeps the planes, so a shared background survives. */
  setDocument(doc: EngineDocument): void {
    this.doc = doc;
    this.index = -1;
    this.revisions.clear();
    this.element.dataset["cmpDocId"] = doc.id;
    this.element.style.width = `${doc.width}px`;
    this.element.style.height = `${doc.height}px`;
  }

  get slide(): EngineSlide | null {
    return this.doc?.slides[this.index] ?? null;
  }

  /** Shows slide `index`, then pre-renders the next one. */
  async show(index: number, transition: TransitionSpec): Promise<void> {
    const doc = this.doc;
    const slide = doc?.slides[index];
    if (!doc || !slide) return;
    const generation = ++this.generation;

    const [bgKey, contentKey] = this.keys(slide);
    await Promise.all([
      this.background.prepare(
        bgKey,
        (layer) => renderBackground(layer, slide.background, this.context),
        { urgent: true },
      ),
      this.content.prepare(
        contentKey,
        (layer) => renderContent(layer, slide, this.context),
        { urgent: true },
      ),
    ]);
    if (generation !== this.generation) return; // a newer show() won

    // Both planes swap in the same frame.
    const shownBackground = this.background.commit(bgKey, transition);
    const shownContent = this.content.commit(contentKey, transition);
    this.index = index;
    this.element.dataset["cmpSlideId"] = slide.id;
    this.element.dataset["cmpSlideIndex"] = String(index);
    this.applyCleared();
    if (shownBackground) this.play(shownBackground);
    if (shownContent) this.play(shownContent);

    this.prepare(index + 1);
  }

  /** Re-renders the visible slide in place (no transition) after a patch. */
  async refresh(): Promise<void> {
    if (this.index < 0) return;
    this.content.invalidate();
    await this.show(this.index, CUT);
  }

  /** Replaces a slide by id. Returns true if this deck had it. */
  patch(slideId: string, input: unknown): boolean {
    const doc = this.doc;
    const position =
      doc?.slides.findIndex((slide) => slide.id === slideId) ?? -1;
    if (!doc || position < 0) return false;
    doc.slides[position] = engineSlideSchema.parse(input);
    this.revisions.set(slideId, (this.revisions.get(slideId) ?? 0) + 1);
    return true;
  }

  applyCleared(): void {
    const hidden = this.isCleared();
    for (const layer of this.content.layers) {
      layer
        .querySelectorAll<HTMLElement>('[data-cmp-role="body"]')
        .forEach((element) => {
          element.style.visibility = hidden ? "hidden" : "";
        });
    }
  }

  /** The video the transport bar controls: foreground first, then background. */
  get activeVideo(): HTMLVideoElement | null {
    return (
      this.content.visibleLayer.querySelector<HTMLVideoElement>(
        'video[data-cmp-media="foreground"]',
      ) ?? this.background.visibleLayer.querySelector<HTMLVideoElement>("video")
    );
  }

  /** Pauses playing videos while an overlay covers this deck. */
  suspend(): void {
    this.resumeOnShow = [...this.element.querySelectorAll("video")].filter(
      (video) => !video.paused,
    );
    this.resumeOnShow.forEach((video) => video.pause());
    this.element.style.visibility = "hidden";
  }

  /** Shows the deck again and resumes exactly the videos that were playing. */
  resume(): void {
    this.element.style.visibility = "";
    this.resumeOnShow.forEach((video) => safePlay(video));
    this.resumeOnShow = [];
  }

  destroy(): void {
    this.generation += 1;
    this.background.destroy();
    this.content.destroy();
    this.element.remove();
  }

  private prepare(index: number): void {
    const slide = this.doc?.slides[index];
    if (!slide) return;
    const [bgKey, contentKey] = this.keys(slide);
    // Only pre-render a background that differs from the visible one; an
    // identical one will simply be kept.
    if (bgKey !== this.background.key) {
      void this.background.prepare(bgKey, (layer) =>
        renderBackground(layer, slide.background, this.context),
      );
    }
    void this.content.prepare(contentKey, (layer) =>
      renderContent(layer, slide, this.context),
    );
  }

  private keys(slide: EngineSlide): [string, string] {
    const revision = this.revisions.get(slide.id) ?? 0;
    return [
      backgroundKey(slide.background),
      `${this.doc?.id}:${slide.id}:${revision}`,
    ];
  }

  private play(layer: HTMLElement): void {
    layer
      .querySelectorAll<HTMLVideoElement>('video[data-cmp-autoplay="true"]')
      .forEach(safePlay);
  }
}

export function safePlay(video: HTMLVideoElement): void {
  try {
    const result = video.play();
    if (result && typeof result.catch === "function") {
      result.catch(() => undefined);
    }
  } catch {
    // Not implemented in jsdom; autoplay policy errors are irrelevant here
    // (the app grants autoplay to its own windows).
  }
}
