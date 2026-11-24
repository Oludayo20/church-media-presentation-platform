/**
 * Text width estimate for slide fitting (DOCUMENTATION.md §5.2 step 4).
 *
 * The spec measures with an off-screen canvas, but songs are generated in
 * the main process (for live sessions) where there is no canvas, and the
 * editor preview must split exactly like the projector. So generation uses
 * one deterministic estimate everywhere: per-character advance widths for a
 * typical UI sans-serif (Inter/Segoe/San Francisco), in em. It errs wide so
 * text fits; the engine's DOM auto-fit (TextRenderer) is the final safety
 * net on screen.
 */
const NARROW = new Set([..."il.,:;'!|ı`´"]);
const SEMI_NARROW = new Set([...'fjrtI()[]{}-"/\\']);
const WIDE = new Set([..."mwMW@%&"]);

export type MeasureText = (
  text: string,
  fontSize: number,
  fontWeight: number,
) => number;

export const estimateTextWidth: MeasureText = (text, fontSize, fontWeight) => {
  let em = 0;
  // Strip combining marks (ọ́ → o) so diacritics do not add width.
  for (const char of text.normalize("NFD").replace(/\p{M}/gu, "")) {
    if (char === " ") em += 0.28;
    else if (NARROW.has(char)) em += 0.27;
    else if (SEMI_NARROW.has(char)) em += 0.36;
    else if (WIDE.has(char)) em += 0.86;
    else if (/[A-Z]/.test(char)) em += 0.68;
    else if (/[0-9]/.test(char)) em += 0.58;
    else em += 0.55;
  }
  const weight = fontWeight >= 600 ? 1.06 : 1;
  return em * fontSize * weight;
};
