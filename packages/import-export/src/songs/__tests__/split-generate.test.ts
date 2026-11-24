import { describe, expect, it } from "vitest";
import { engineDocumentSchema } from "@cmp/shared-validation/engine-protocol";
import {
  copyrightLine,
  DEFAULT_SONG_BACKGROUND,
  estimateTextWidth,
  fitChunk,
  fitFontSize,
  generateSongDocument,
  splitSection,
  type GeneratorInput,
} from "../index";

const box = {
  width: 1600,
  height: 760,
  fontSize: 88,
  minFontSize: 48,
  fontWeight: 700,
  lineHeight: 1.25,
};

describe("splitSection", () => {
  const lyrics = "one\ntwo\nthree\n\nfour\nfive";
  it("chunks by lines without crossing stanza breaks", () => {
    expect(
      splitSection(lyrics, { mode: "lines", linesPerSlide: 2, maxChars: 0 }),
    ).toEqual([["one", "two"], ["three"], ["four", "five"]]);
  });

  it("chunks by character budget, never mid-line", () => {
    const text = "a".repeat(50) + "\n" + "b".repeat(50) + "\n" + "c".repeat(50);
    expect(
      splitSection(text, {
        mode: "chars",
        linesPerSlide: 2,
        maxChars: 120,
      }).map((c) => c.length),
    ).toEqual([2, 1]);
    // A single over-long line is its own chunk.
    expect(
      splitSection("x".repeat(500), {
        mode: "chars",
        linesPerSlide: 2,
        maxChars: 120,
      }),
    ).toEqual([["x".repeat(500)]]);
  });

  it("ignores empty stanzas", () => {
    expect(
      splitSection("\n\n\none\n\n\n", {
        mode: "lines",
        linesPerSlide: 4,
        maxChars: 0,
      }),
    ).toEqual([["one"]]);
  });
});

describe("fitting", () => {
  it("keeps the template size when short lines fit", () => {
    expect(fitFontSize(["Short line", "Another"], box, estimateTextWidth)).toBe(
      88,
    );
  });

  it("shrinks long text towards the minimum", () => {
    const lines = Array.from(
      { length: 4 },
      () => "This is a fairly long lyric line that wraps once",
    );
    const size = fitFontSize(lines, box, estimateTextWidth)!;
    expect(size).toBeLessThan(88);
    expect(size).toBeGreaterThanOrEqual(48);
  });

  it("splits a chunk that overflows even at the minimum size", () => {
    // 20 lines × 48 px × 1.25 = 1200 px > 760 px even at the minimum size.
    const lines = Array.from(
      { length: 20 },
      (_, i) => `Line number ${i} with plenty of words to wrap around`,
    );
    const parts = fitChunk(lines, box, estimateTextWidth);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flatMap((part) => part.lines)).toEqual(lines);
  });

  it("keeps a single impossible line at the minimum size", () => {
    expect(fitChunk(["W".repeat(2000)], box, estimateTextWidth)).toEqual([
      { lines: ["W".repeat(2000)], fontSize: 48 },
    ]);
  });

  it("diacritics add no width", () => {
    expect(estimateTextWidth("Ọlọ́run", 80, 700)).toBeCloseTo(
      estimateTextWidth("Olorun", 80, 700),
    );
  });
});

const base: GeneratorInput = {
  songId: "S1",
  title: "Morning Song",
  artist: "A. Writer",
  copyrightOwner: "Example Music",
  copyrightYear: 2024,
  ccliNumber: "1234567",
  sections: [
    { id: "v1", label: "Verse 1", lyrics: "line a\nline b\nline c" },
    { id: "c", label: "Chorus", lyrics: "chorus x\nchorus y" },
  ],
  arrangement: ["v1", "c", "c", "missing"],
  split: {
    mode: "lines",
    linesPerSlide: 2,
    maxChars: 120,
    blankBetweenSections: false,
  },
  templateId: null,
  background: DEFAULT_SONG_BACKGROUND,
  showCopyright: true,
};

describe("generateSongDocument", () => {
  it("emits a valid engine document following the arrangement", () => {
    const doc = engineDocumentSchema.parse(generateSongDocument(base));
    expect(doc.id).toBe("song:S1");
    expect(doc.slides.map((s) => s.id)).toEqual([
      "v1~0~0",
      "v1~1~0",
      "c~0~0",
      "c~0~1",
    ]);
    expect(doc.slides.map((s) => s.meta?.["sectionLabel"])).toEqual([
      "Verse 1",
      "Verse 1",
      "Chorus",
      "Chorus",
    ]);
  });

  it("puts the copyright footer on the first and last slide only", () => {
    const doc = generateSongDocument(base);
    const hasFooter = doc.slides.map((s) =>
      (s.objects ?? []).some((o) => o.id === "copyright"),
    );
    expect(hasFooter).toEqual([true, false, false, true]);
    expect(copyrightLine(base)).toBe(
      "Morning Song · A. Writer · © 2024 Example Music · CCLI #1234567",
    );
    expect(
      generateSongDocument({ ...base, showCopyright: false }).slides.some(
        (s) => (s.objects ?? []).length > 1,
      ),
    ).toBe(false);
  });

  it("can insert blank slides between sections", () => {
    const doc = generateSongDocument({
      ...base,
      split: { ...base.split, blankBetweenSections: true },
    });
    expect(doc.slides.map((s) => s.id)).toEqual([
      "v1~0~0",
      "v1~1~0",
      "c~blank~0",
      "c~0~0",
      "c~blank~1",
      "c~0~1",
    ]);
  });

  it("uses section order when the arrangement is empty, and never returns zero slides", () => {
    expect(
      generateSongDocument({ ...base, arrangement: [] }).slides,
    ).toHaveLength(3);
    expect(
      generateSongDocument({ ...base, sections: [], arrangement: [] }).slides,
    ).toHaveLength(1);
  });

  it("an edit to one section keeps every other slide id and content", () => {
    const before = generateSongDocument(base);
    const after = generateSongDocument({
      ...base,
      sections: [
        base.sections[0]!,
        { id: "c", label: "Chorus", lyrics: "chorus FIXED\nchorus y" },
      ],
    });
    expect(after.slides.map((s) => s.id)).toEqual(
      before.slides.map((s) => s.id),
    );
    const changed = after.slides.filter(
      (slide, i) => JSON.stringify(slide) !== JSON.stringify(before.slides[i]),
    );
    expect(changed.map((s) => s.id)).toEqual(["c~0~0", "c~0~1"]);
  });

  it("bold template upper-cases lyrics", () => {
    const doc = generateSongDocument({ ...base, templateId: "bold" });
    const text = doc.slides[0]!.objects![0] as { content: string };
    expect(text.content).toBe("LINE A\nLINE B");
  });
});
