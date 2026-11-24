import {
  ENGINE_DOCUMENT_SCHEMA_VERSION,
  type Background,
  type EngineDocumentInput,
} from "@cmp/shared-validation/engine-protocol";
import { estimateTextWidth, type MeasureText } from "./measure";
import { fitChunk, splitSection, type SplitOptions } from "./split";
import { songTemplate } from "./templates";

export interface GeneratorSection {
  id: string;
  label: string;
  lyrics: string;
}

export interface GeneratorInput {
  songId: string;
  title: string;
  artist: string | null;
  copyrightOwner: string | null;
  copyrightYear: number | null;
  ccliNumber: string | null;
  sections: GeneratorSection[];
  /** Section ids in performance order (repeats allowed). */
  arrangement: string[];
  split: SplitOptions & { blankBetweenSections: boolean };
  templateId: string | null;
  background: Background;
  showCopyright: boolean;
  measure?: MeasureText;
}

const DEFAULT_BACKGROUND: Background = {
  type: "gradient",
  angle: 160,
  stops: ["#1b1f3b", "#3d2c6b", "#0e1116"],
};
export { DEFAULT_BACKGROUND as DEFAULT_SONG_BACKGROUND };

/**
 * DOCUMENTATION.md §5.2: arrangement → sections → chunks → fitted slides.
 *
 * Slide ids are `<sectionId>~<chunk>~<occurrence>`: stable across edits of
 * other sections, so a live lyric fix patches only the slides that changed
 * (§3.6), and every occurrence of a repeated chorus is patched together.
 */
export function generateSongDocument(
  input: GeneratorInput,
): EngineDocumentInput {
  const template = songTemplate(input.templateId);
  const measure = input.measure ?? estimateTextWidth;
  const byId = new Map(input.sections.map((section) => [section.id, section]));
  const order = (
    input.arrangement.length > 0
      ? input.arrangement
      : input.sections.map((s) => s.id)
  ).filter((id) => byId.has(id));
  const occurrences = new Map<string, number>();
  const slides: EngineDocumentInput["slides"] = [];

  order.forEach((sectionId, position) => {
    const section = byId.get(sectionId)!;
    const occurrence = occurrences.get(sectionId) ?? 0;
    occurrences.set(sectionId, occurrence + 1);
    const text = template.uppercase
      ? section.lyrics.toLocaleUpperCase()
      : section.lyrics;
    const chunks = splitSection(text, input.split).flatMap((lines) =>
      fitChunk(
        lines,
        {
          width: template.box.w,
          height: template.box.h,
          fontSize: template.fontSize,
          minFontSize: template.minFontSize,
          fontWeight: template.fontWeight,
          lineHeight: template.lineHeight,
        },
        measure,
      ),
    );

    if (input.split.blankBetweenSections && position > 0) {
      slides.push({
        id: `${sectionId}~blank~${occurrence}`,
        background: input.background,
        objects: [],
        meta: { sectionId, sectionLabel: section.label, blank: 1 },
      });
    }
    chunks.forEach((chunk, chunkIndex) => {
      slides.push({
        id: `${sectionId}~${chunkIndex}~${occurrence}`,
        background: input.background,
        objects: [
          {
            id: "lyrics",
            type: "text",
            frame: {
              x: template.box.x,
              y: template.box.y,
              w: template.box.w,
              h: template.box.h,
            },
            content: chunk.lines.join("\n"),
            style: {
              fontFamily: template.fontFamily,
              fontSize: chunk.fontSize,
              fontWeight: template.fontWeight,
              color: template.color,
              align: template.align,
              vAlign: template.vAlign,
              lineHeight: template.lineHeight,
              shadow: template.shadow,
              autoFit: true,
            },
          },
        ],
        meta: {
          songId: input.songId,
          sectionId,
          sectionLabel: section.label,
          chunkIndex,
        },
      });
    });
  });

  if (slides.length === 0) {
    slides.push({
      id: "empty",
      background: input.background,
      objects: [],
      meta: { sectionLabel: "" },
    });
  }

  // §5.2 step 6: copyright footer on the first and last slide.
  const footer = copyrightLine(input);
  if (input.showCopyright && footer) {
    for (const slide of new Set([slides[0]!, slides[slides.length - 1]!])) {
      slide.objects = [
        ...(slide.objects ?? []),
        {
          id: "copyright",
          type: "text",
          role: "footer",
          frame: { x: 120, y: 1000, w: 1680, h: 56 },
          content: footer,
          style: {
            fontSize: 26,
            fontWeight: 500,
            color: "#d0d4dc",
            autoFit: true,
            shadow: "0 2px 6px #000",
          },
        },
      ];
    }
  }

  return {
    schemaVersion: ENGINE_DOCUMENT_SCHEMA_VERSION,
    id: `song:${input.songId}`,
    title: input.title,
    width: 1920,
    height: 1080,
    slides,
  };
}

/** "Title · Author · © 2004 Owner · CCLI #1234567". */
export function copyrightLine(input: {
  title: string;
  artist: string | null;
  copyrightOwner: string | null;
  copyrightYear: number | null;
  ccliNumber: string | null;
}): string | null {
  const owner = input.copyrightOwner
    ? `© ${input.copyrightYear ? `${input.copyrightYear} ` : ""}${input.copyrightOwner}`
    : null;
  const parts = [
    input.title,
    input.artist,
    owner,
    input.ccliNumber ? `CCLI #${input.ccliNumber}` : null,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 1 ? parts.join(" · ") : null;
}
