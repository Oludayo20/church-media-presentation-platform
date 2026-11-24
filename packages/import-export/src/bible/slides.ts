import {
  ENGINE_DOCUMENT_SCHEMA_VERSION,
  parseEngineDocument,
} from "@cmp/shared-validation/engine-protocol";
import { estimateTextWidth } from "../songs/measure";
import { fitChunk } from "../songs/split";

export function generateScriptureDocument(
  title: string,
  translation: string,
  verses: string[],
  onePerSlide: boolean,
) {
  const box = {
    width: 1600,
    height: 720,
    fontSize: 76,
    minFontSize: 56,
    fontWeight: 600,
    lineHeight: 1.25,
  };
  const groups = onePerSlide ? verses.map((verse) => [verse]) : [verses];
  const pages = groups.flatMap((lines) =>
    fitChunk(lines, box, estimateTextWidth),
  );
  return parseEngineDocument({
    schemaVersion: ENGINE_DOCUMENT_SCHEMA_VERSION,
    id: `scripture:${translation}:${title}`,
    title,
    width: 1920,
    height: 1080,
    slides: pages.map(({ lines, fontSize }, index) => ({
      id: `scripture-${index + 1}`,
      background: { type: "color", value: "#151b28" },
      objects: [
        {
          id: "passage",
          type: "text",
          frame: { x: 160, y: 110, w: box.width, h: box.height },
          content: lines.join("\n"),
          style: {
            fontSize,
            fontWeight: box.fontWeight,
            lineHeight: box.lineHeight,
            align: "center",
            vAlign: "middle",
            autoFit: true,
          },
        },
        {
          id: "reference",
          type: "text",
          role: "footer",
          frame: { x: 160, y: 875, w: box.width, h: 110 },
          content: `${title} · ${translation}${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ""}`,
          style: {
            fontSize: 48,
            align: "center",
            vAlign: "middle",
            autoFit: true,
          },
        },
      ],
    })),
  });
}
