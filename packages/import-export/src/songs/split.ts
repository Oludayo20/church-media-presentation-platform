import type { MeasureText } from "./measure";

export interface SplitOptions {
  mode: "lines" | "chars";
  linesPerSlide: number;
  maxChars: number;
}

export interface FitBox {
  width: number;
  height: number;
  fontSize: number;
  minFontSize: number;
  fontWeight: number;
  lineHeight: number;
}

/** Stanzas of a section: blank-line separated, each a list of lines. */
export function stanzasOf(lyrics: string): string[][] {
  return lyrics
    .split(/\n\s*\n/)
    .map((stanza) =>
      stanza
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((stanza) => stanza.length > 0);
}

/**
 * §5.2 step 3: chunk a section by line count or character budget. Never
 * splits mid-line and never joins lines across a stanza break.
 */
export function splitSection(
  lyrics: string,
  options: SplitOptions,
): string[][] {
  const chunks: string[][] = [];
  for (const stanza of stanzasOf(lyrics)) {
    if (options.mode === "lines") {
      const size = Math.max(1, options.linesPerSlide);
      for (let start = 0; start < stanza.length; start += size) {
        chunks.push(stanza.slice(start, start + size));
      }
      continue;
    }
    let current: string[] = [];
    let chars = 0;
    for (const line of stanza) {
      if (current.length > 0 && chars + line.length > options.maxChars) {
        chunks.push(current);
        current = [];
        chars = 0;
      }
      current.push(line);
      chars += line.length;
    }
    if (current.length > 0) chunks.push(current);
  }
  return chunks;
}

/**
 * §5.2 step 4: the largest font size (from `fontSize` down to
 * `minFontSize`) at which the lines, wrapped to the box width, fit its
 * height. `null` when even the minimum overflows.
 */
export function fitFontSize(
  lines: string[],
  box: FitBox,
  measure: MeasureText,
): number | null {
  for (let size = box.fontSize; size >= box.minFontSize; size -= 2) {
    const rows = lines.reduce(
      (sum, line) =>
        sum +
        Math.max(1, Math.ceil(measure(line, size, box.fontWeight) / box.width)),
      0,
    );
    if (rows * size * box.lineHeight <= box.height) return size;
  }
  return null;
}

/**
 * Fits a chunk, splitting it in half (again and again) while it overflows
 * even at the minimum size. A single line that still overflows is kept at
 * the minimum size; the engine's DOM auto-fit shrinks it further.
 */
export function fitChunk(
  lines: string[],
  box: FitBox,
  measure: MeasureText,
): { lines: string[]; fontSize: number }[] {
  const size = fitFontSize(lines, box, measure);
  if (size !== null) return [{ lines, fontSize: size }];
  if (lines.length === 1) return [{ lines, fontSize: box.minFontSize }];
  const middle = Math.ceil(lines.length / 2);
  return [
    ...fitChunk(lines.slice(0, middle), box, measure),
    ...fitChunk(lines.slice(middle), box, measure),
  ];
}
