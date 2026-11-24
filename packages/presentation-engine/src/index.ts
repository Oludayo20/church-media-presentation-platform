/**
 * @cmp/presentation-engine — the React-free renderer behind the audience
 * window and every operator preview (docs/DOCUMENTATION.md §3.3). It must
 * never import React (dependency-cruiser rule `engine-no-react`) so UI
 * re-renders can never stall the projector.
 *
 * The protocol (documents, commands, state) is re-exported from
 * `@cmp/shared-validation/engine-protocol`, where the main process imports it.
 */
export * from "./protocol";
export {
  createPresentationEngine,
  type EngineOptions,
  type PresentationEngine,
} from "./engine/engine";
export { renderStaticSlide } from "./engine/static";
export { registerFonts } from "./engine/fonts";
