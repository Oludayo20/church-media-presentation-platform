const registered = new WeakMap<Document, Map<string, FontFace>>();

/**
 * Registers imported fonts with `FontFace` (docs/TASKS.md Phase 7). Each
 * source is added once per document. Registration is additive on purpose:
 * several engines share one document (operator previews), and one without
 * fonts in its config must not unregister another's. Loading happens in the
 * background — text re-lays out when a face arrives, and a face that fails
 * simply falls back to the next family in the stack.
 */
export function registerFonts(
  doc: Document,
  fonts: readonly { family: string; src: string }[],
): void {
  const view = doc.defaultView as
    (Window & { FontFace?: typeof FontFace }) | null;
  if (!view?.FontFace || !doc.fonts) return; // jsdom
  const current = registered.get(doc) ?? new Map<string, FontFace>();
  registered.set(doc, current);
  for (const font of fonts) {
    const key = `${font.family}\u0000${font.src}`;
    if (current.has(key)) continue;
    const face = new view.FontFace(
      font.family,
      `url("${font.src.replace(/["\\]/g, "")}")`,
    );
    current.set(key, face);
    doc.fonts.add(face);
    face.load().catch(() => undefined);
  }
}
