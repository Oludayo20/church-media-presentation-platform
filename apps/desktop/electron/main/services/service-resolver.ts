import type { ServiceItemData } from "@cmp/shared-types";
import {
  ENGINE_DOCUMENT_SCHEMA_VERSION,
  parseEngineDocument,
  type Background,
  type EngineDocument,
  type EngineDocumentInput,
} from "@cmp/shared-validation";
import type { OpenWorkspace } from "../workspace/workspace-manager";
import type { PlaylistItem } from "../live/live-session";

export interface ResolverDeps {
  workspace: OpenWorkspace;
  /** Song slides (§5), with per-item template/background overrides. */
  songDocument(songId: string, overrides: { templateId: string | null; backgroundAssetId: string | null }): Promise<EngineDocument>;
  scriptureDocument(translation: string, reference: string, onePerSlide: boolean): Promise<EngineDocument>;
  logo(): Promise<{ src: string | null; text: string | null }>;
}

export type Resolved =
  | { ok: true; item: PlaylistItem }
  | { ok: false; title: string; problem: string };

const W = 1920;
const H = 1080;
const DARK: Background = { type: "gradient", angle: 160, stops: ["#0e1116", "#1b1f3b"] };
const assetUrl = (id: string) => `cmp-media://asset/${id}`;

function doc(id: string, title: string, slides: EngineDocumentInput["slides"]): EngineDocument {
  const parsed = parseEngineDocument({ schemaVersion: ENGINE_DOCUMENT_SCHEMA_VERSION, id, title, width: W, height: H, slides });
  if (!parsed.success) throw new Error(parsed.error);
  return parsed.doc;
}

/**
 * Service resolution (DOCUMENTATION.md §3.2): every service item becomes an
 * engine document. Items that cannot be shown (an empty placeholder, a
 * missing reference, an unknown passage) are reported, never fatal.
 */
export async function resolveServiceItem(item: ServiceItemData, deps: ResolverDeps): Promise<Resolved> {
  const { workspace } = deps;
  const id = `svc:${item.id}`;
  const fail = (title: string, problem: string): Resolved => ({ ok: false, title: item.label ?? title, problem });
  const options = item.options;

  try {
    switch (options.type) {
      case "presentation":
      case "announcement": {
        if (!item.refId) return fail(options.type === "presentation" ? "Presentation" : "Announcements", "Choose a presentation");
        const saved = await workspace.presentations.get(item.refId).catch(() => null);
        const parsed = saved ? parseEngineDocument(saved.snapshot) : null;
        if (!parsed?.success) return fail("Presentation", "The presentation is missing");
        const title = item.label ?? parsed.doc.title;
        if (options.type === "presentation") {
          return { ok: true, item: { id, title, kind: "presentation", doc: { ...parsed.doc, id } } };
        }
        // Announcements rotate: every slide shows for the item's duration (§8.4).
        return {
          ok: true,
          item: {
            id,
            title,
            kind: "announcement",
            doc: { ...parsed.doc, id, slides: parsed.doc.slides.map((slide) => ({ ...slide, durationMs: options.durationMs })) },
            auto: { kind: "rotate", loop: options.loop },
          },
        };
      }
      case "song": {
        if (!item.refId) return fail("Song", "Choose a song");
        const song = await workspace.songs.get(item.refId);
        if (!song) return fail("Song", "The song is missing");
        const songDoc = await deps.songDocument(song.id, {
          templateId: options.templateId,
          backgroundAssetId: options.backgroundAssetId,
        });
        return { ok: true, item: { id, title: item.label ?? song.title, kind: "song", doc: { ...songDoc, id }, songId: song.id } };
      }
      case "scripture": {
        if (!options.reference.trim()) return fail("Scripture", "Choose a passage");
        const passage = await deps.scriptureDocument(options.translation, options.reference, options.onePerSlide).catch(() => null);
        if (!passage) return fail(options.reference, `${options.reference} (${options.translation}) is not available`);
        return { ok: true, item: { id, title: item.label ?? passage.title, kind: "scripture", doc: { ...passage, id } } };
      }
      case "video":
      case "image": {
        if (!item.refId) return fail(options.type === "video" ? "Video" : "Image", `Choose ${options.type === "video" ? "a video" : "an image"}`);
        const asset = await workspace.media.findById(item.refId);
        if (!asset) return fail("Media", "The media file is missing");
        if (asset.isMissing) return fail(asset.name, `${asset.name} is missing from the media folder`);
        const slides: EngineDocumentInput["slides"] =
          options.type === "video"
            ? [
                {
                  id: "media",
                  background: { type: "color", value: "#000000" },
                  objects: [
                    {
                      id: "video",
                      type: "video",
                      frame: { x: 0, y: 0, w: W, h: H },
                      src: assetUrl(asset.id),
                      loop: options.loop,
                      muted: options.muted,
                      autoplay: true,
                    },
                  ],
                },
              ]
            : [{ id: "media", background: { type: "image", src: assetUrl(asset.id), fit: "contain" }, objects: [] }];
        return { ok: true, item: { id, title: item.label ?? asset.name, kind: "media", doc: doc(id, asset.name, slides) } };
      }
      case "countdown": {
        let background: Background = DARK;
        if (options.backgroundAssetId) {
          const asset = await workspace.media.findById(options.backgroundAssetId);
          if (asset && !asset.isMissing && asset.mediaType === "video") {
            background = { type: "video", src: assetUrl(asset.id), loop: true, muted: true, fit: "cover" };
          } else if (asset && !asset.isMissing && asset.mediaType === "image") {
            background = { type: "image", src: assetUrl(asset.id), fit: "cover" };
          }
        }
        const title = item.label ?? "Countdown";
        return {
          ok: true,
          item: {
            id,
            title,
            kind: "countdown",
            doc: doc(id, title, [
              {
                id: "countdown",
                background,
                objects: [
                  ...(options.title
                    ? [
                        {
                          id: "title",
                          type: "text" as const,
                          frame: { x: 160, y: 250, w: 1600, h: 140 },
                          content: options.title,
                          style: { fontSize: 72, fontWeight: 600, shadow: "0 4px 18px #000c" },
                        },
                      ]
                    : []),
                  {
                    id: "clock",
                    type: "countdown" as const,
                    frame: { x: 160, y: 400, w: 1600, h: 360 },
                    durationMs: options.durationMs,
                    style: { fontSize: 280, fontWeight: 700, shadow: "0 6px 24px #000c" },
                  },
                ],
              },
            ]),
            auto: { kind: "countdown", durationMs: options.durationMs, onComplete: options.onComplete, chime: options.chime },
          },
        };
      }
      case "blank":
      case "camera_placeholder": {
        const logo = options.type === "blank" && options.mode === "logo" ? await deps.logo() : { src: null, text: null };
        const objects: EngineDocumentInput["slides"][number]["objects"] = logo.src
          ? [{ id: "logo", type: "image", frame: { x: 660, y: 240, w: 600, h: 600 }, src: logo.src, fit: "contain" }]
          : logo.text
            ? [{ id: "name", type: "text", frame: { x: 160, y: 380, w: 1600, h: 320 }, content: logo.text, style: { fontSize: 96 } }]
            : [];
        const title = item.label ?? (options.type === "camera_placeholder" ? "Camera" : "Blank");
        const resolved: Resolved = {
          ok: true,
          item: { id, title, kind: "blank", doc: doc(id, title, [{ id: "blank", background: { type: "color", value: "#000000" }, objects }]) },
        };
        return resolved;
      }
    }
  } catch {
    return fail("Item", "This item could not be prepared");
  }
}
