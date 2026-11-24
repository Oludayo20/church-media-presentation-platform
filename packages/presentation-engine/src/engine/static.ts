import type { EngineConfig, EngineDocumentInput } from "../protocol";
import { createPresentationEngine, type PresentationEngine } from "./engine";

const STATIC_CONFIG: EngineConfig = {
  fallbackBackground: { type: "color", value: "#000000" },
  logoSrc: null,
  logoText: null,
  safeAreaPct: 5,
  defaultTransition: { type: "cut", ms: 0 },
};

/**
 * Renders one slide, cut, with videos frozen on their first frame: used for
 * the operator's current/next previews and the thumbnail strip.
 */
export function renderStaticSlide(
  root: HTMLElement,
  doc: EngineDocumentInput,
  slideIndex: number,
  config?: EngineConfig,
): PresentationEngine {
  const engine = createPresentationEngine(root, {
    mode: "static",
    mediaTimeoutMs: 1500,
  });
  void engine.apply({
    seq: 1,
    type: "config",
    config: {
      ...(config ?? STATIC_CONFIG),
      defaultTransition: { type: "cut", ms: 0 },
    },
  });
  void engine.apply({
    seq: 2,
    type: "load",
    doc: stripTransitions(doc),
    startSlide: slideIndex,
  });
  return engine;
}

function stripTransitions(doc: EngineDocumentInput): EngineDocumentInput {
  return {
    ...doc,
    slides: doc.slides.map(({ transition: _transition, ...slide }) => slide),
  };
}
