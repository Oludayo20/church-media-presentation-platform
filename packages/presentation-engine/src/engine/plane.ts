import type { TransitionSpec } from "../protocol";
import { createElement, FILL, releaseMedia } from "./dom";

/**
 * A pair of stacked layers — `front` (visible) and `back` (being prepared).
 * `commit` swaps them with a cut or a fade (DOCUMENTATION.md §3.3 double
 * buffering + TransitionManager). A new swap finishes any running fade first,
 * so rapid next-next-next never stacks transitions.
 *
 * During a fade the back layer is still the *outgoing* picture underneath,
 * so speculative pre-renders wait for the fade to end before reusing it;
 * an urgent prepare (the slide is about to be shown) settles the fade first.
 */
export class Plane {
  readonly element: HTMLElement;
  private front: HTMLElement;
  private back: HTMLElement;
  private frontKey: string | null = null;
  private backKey: string | null = null;
  private backBuild: Promise<void> | null = null;
  private finishRunning: (() => void) | null = null;
  /** Resolves when no fade is running. */
  private idle: Promise<void> = Promise.resolve();

  constructor(doc: Document, name: string) {
    this.element = createElement(doc, "div", FILL, { cmpPlane: name });
    this.front = this.makeLayer(doc, "a");
    this.back = this.makeLayer(doc, "b");
    this.element.append(this.front, this.back);
  }

  get key(): string | null {
    return this.frontKey;
  }

  get visibleLayer(): HTMLElement {
    return this.front;
  }

  /** All layers, for whole-plane operations (clear, pause). */
  get layers(): HTMLElement[] {
    return [this.front, this.back];
  }

  /**
   * Pre-renders `key` into the back layer (no-op if already there).
   * `urgent`: the slide is about to be committed, so cut any running fade
   * short rather than wait for it.
   */
  prepare(
    key: string,
    build: (layer: HTMLElement) => Promise<void>,
    options: { urgent?: boolean } = {},
  ): Promise<void> {
    if (options.urgent) this.settle();
    if (key === this.frontKey) return Promise.resolve();
    if (key === this.backKey && this.backBuild) return this.backBuild;
    this.backKey = key;
    const run = async () => {
      await this.idle;
      if (this.backKey !== key) return; // superseded while waiting
      this.resetLayer(this.back);
      // Each build gets its own container: if it is superseded, its late
      // appends land in a detached node instead of the reused layer.
      const target = createElement(this.back.ownerDocument, "div", FILL);
      this.back.append(target);
      await build(target);
    };
    this.backBuild = run().catch(() => undefined);
    return this.backBuild;
  }

  /**
   * Makes the prepared `key` visible. An unchanged key is left alone; this
   * is what keeps a shared motion background playing across slides.
   * Returns the newly visible layer, or null when nothing changed.
   */
  commit(key: string, transition: TransitionSpec): HTMLElement | null {
    if (key === this.frontKey) return null;
    if (key !== this.backKey) return null; // superseded while building
    return this.swap(transition);
  }

  /** Forces the next commit of the current key to rebuild (patch). */
  invalidate(): void {
    this.frontKey = null;
    if (this.backKey !== null) {
      this.backKey = null;
      this.backBuild = null;
    }
  }

  /** Finishes a running fade immediately. */
  settle(): void {
    this.finishRunning?.();
  }

  private swap(transition: TransitionSpec): HTMLElement {
    this.finishRunning?.();
    const incoming = this.back;
    const outgoing = this.front;
    this.front = incoming;
    this.back = outgoing;
    this.frontKey = this.backKey;
    this.backKey = null;
    this.backBuild = null;

    incoming.style.zIndex = "2";
    outgoing.style.zIndex = "1";
    incoming.style.visibility = "visible";

    let resolveIdle: () => void = () => {};
    const retire = () => {
      this.finishRunning = null;
      incoming.style.transition = "";
      incoming.style.opacity = "1";
      // Nothing can have been built into `outgoing` yet: builds wait for idle.
      if (this.back === outgoing) this.resetLayer(outgoing);
      resolveIdle();
    };

    if (transition.type === "fade" && transition.ms > 0) {
      this.idle = new Promise((resolve) => (resolveIdle = resolve));
      incoming.style.transition = "";
      incoming.style.opacity = "0";
      void incoming.offsetWidth; // commit the start state
      incoming.style.transition = `opacity ${transition.ms}ms linear`;
      incoming.style.opacity = "1";
      const timer = setTimeout(retire, transition.ms);
      this.finishRunning = () => {
        clearTimeout(timer);
        retire();
      };
    } else {
      retire();
    }
    return incoming;
  }

  private makeLayer(doc: Document, id: string): HTMLElement {
    return createElement(
      doc,
      "div",
      { ...FILL, overflow: "hidden", visibility: "hidden", opacity: "1" },
      { cmpLayer: id },
    );
  }

  private resetLayer(layer: HTMLElement): void {
    releaseMedia(layer);
    layer.replaceChildren();
    layer.style.background = "";
    layer.style.visibility = "hidden";
    layer.style.opacity = "1";
    layer.style.transition = "";
  }

  destroy(): void {
    this.finishRunning?.();
    releaseMedia(this.element);
    this.element.remove();
  }
}
