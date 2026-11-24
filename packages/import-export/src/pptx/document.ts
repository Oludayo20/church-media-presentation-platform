import {
  ENGINE_DOCUMENT_SCHEMA_VERSION,
  type EngineDocumentInput,
} from "@cmp/shared-validation/engine-protocol";
import type { PptxDeck, PptxReport } from "./parse";

/**
 * Builds the engine document for an imported deck. `mediaUrl` maps a zip
 * path to its library asset URL, or null when that file failed to import —
 * the object is then dropped and counted in the report.
 */
export function pptxToDocument(
  deck: PptxDeck,
  mediaUrl: (zipPath: string) => string | null,
): { doc: EngineDocumentInput; report: PptxReport } {
  const report: PptxReport = { dropped: { ...deck.report.dropped } };
  const missing = (kind: string) => {
    report.dropped[kind] = (report.dropped[kind] ?? 0) + 1;
  };

  const slides: EngineDocumentInput["slides"] = deck.slides.map(
    (slide, index) => {
      let background: EngineDocumentInput["slides"][number]["background"];
      if (slide.background.type === "image") {
        const src = mediaUrl(slide.background.media);
        if (src) background = { type: "image", src, fit: "cover" };
        else {
          missing("Background picture that could not be imported");
          background = { type: "color", value: "#000000" };
        }
      } else {
        background = slide.background;
      }

      const objects: NonNullable<
        EngineDocumentInput["slides"][number]["objects"]
      > = [];
      slide.objects.forEach((object, position) => {
        const id = `o${position + 1}`;
        switch (object.kind) {
          case "text":
            objects.push({
              id,
              type: "text",
              frame: object.frame,
              content: object.content.slice(0, 10_000),
              style: { ...object.style, autoFit: true },
            });
            return;
          case "shape":
            objects.push({
              id,
              type: "shape",
              frame: object.frame,
              fill: object.fill,
              radius: object.radius,
            });
            return;
          case "image": {
            const src = mediaUrl(object.media);
            if (src)
              objects.push({
                id,
                type: "image",
                frame: object.frame,
                src,
                fit: "contain",
              });
            else missing("Picture that could not be imported");
            return;
          }
          case "video": {
            const src = mediaUrl(object.media);
            if (src)
              objects.push({
                id,
                type: "video",
                frame: object.frame,
                src,
                autoplay: false,
                loop: false,
                muted: false,
              });
            else missing("Video that could not be imported");
            return;
          }
        }
      });

      return {
        id: `s${index + 1}`,
        background,
        objects: objects.slice(0, 200),
        ...(slide.transition.type === "fade"
          ? { transition: slide.transition }
          : {}),
      };
    },
  );

  return {
    doc: {
      schemaVersion: ENGINE_DOCUMENT_SCHEMA_VERSION,
      id: "pptx-import",
      title: deck.title,
      width: deck.width,
      height: deck.height,
      slides,
    },
    report,
  };
}
