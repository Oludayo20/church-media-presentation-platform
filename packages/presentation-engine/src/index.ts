/**
 * @cmp/presentation-engine — the React-free renderer for the audience window.
 *
 * Phase 0 ships only the output surface the audience window mounts into, so
 * the build, the dependency rules (no React, no apps/*) and the audience
 * entry point are all exercised from day one. The engine itself
 * (loader, slide renderers, transitions, playback) lands in Phase 2 —
 * see docs/DOCUMENTATION.md §3.3.
 */
export const ENGINE_DOCUMENT_SCHEMA_VERSION = "cmp.presentation/v1";

export interface OutputSurface {
  /** The element slides will be rendered into. */
  readonly stage: HTMLElement;
  destroy(): void;
}

/**
 * Prepares `root` as a black, full-bleed, cursorless output surface.
 * The audience must never see anything but black before content arrives.
 */
export function createOutputSurface(root: HTMLElement): OutputSurface {
  const doc = root.ownerDocument;
  const stage = doc.createElement("div");
  stage.dataset["cmpStage"] = "";
  Object.assign(stage.style, {
    position: "fixed",
    inset: "0",
    overflow: "hidden",
    background: "#000",
    cursor: "none",
  });
  root.replaceChildren(stage);

  return {
    stage,
    destroy() {
      stage.remove();
    },
  };
}
