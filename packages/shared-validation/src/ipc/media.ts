import { z } from "zod";
import {
  LICENCE_TYPE_NAMES,
  type JobProgress,
  type MediaDetail,
  type MediaFolderInfo,
  type MediaItem,
} from "@cmp/shared-types";

/** Library categories (DOCUMENTATION.md §12 `media_assets.category`). */
export const MEDIA_CATEGORIES = {
  motion_background: "Motion background",
  video: "Video",
  image: "Image",
  flyer: "Flyer",
  logo: "Logo",
  audio: "Audio",
  document: "Document",
  font: "Font",
  "test-deck": "Test deck",
} as const;
export type MediaCategory = keyof typeof MEDIA_CATEGORIES;

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1, "Enter a name").max(200);
const mediaType = z.enum(["image", "video", "audio", "document", "font"]);
const category = z.enum(
  Object.keys(MEDIA_CATEGORIES) as [MediaCategory, ...MediaCategory[]],
);
const tagList = z.array(z.string().trim().min(1).max(40)).max(30);

export const mediaItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  mediaType,
  category: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSize: z.number(),
  durationMs: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  codec: z.string().nullable(),
  hasAudio: z.boolean(),
  hasThumbnail: z.boolean(),
  transcodeReason: z.enum(["unsupported-codec", "large-gif"]).nullable(),
  playbackWarning: z.enum(["hevc"]).nullable(),
  fontFamily: z.string().nullable(),
  isFavourite: z.boolean(),
  isMissing: z.boolean(),
  folderId: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: z.string(),
}) satisfies z.ZodType<MediaItem>;

export const licenceSchema = z.object({
  licenceType: z.enum(LICENCE_TYPE_NAMES),
  source: z.string().trim().max(500).nullable(),
  attribution: z.string().trim().max(500).nullable(),
  terms: z.string().trim().max(2000).nullable(),
});

export const mediaDetailSchema = mediaItemSchema.extend({
  originalName: z.string().nullable(),
  licence: licenceSchema.nullable(),
  usedBy: z.array(
    z.object({
      type: z.enum(["church-logo", "logo-screen", "presentation", "song", "service"]),
      id: z.string(),
      title: z.string(),
    }),
  ),
}) satisfies z.ZodType<MediaDetail>;

export const mediaFolderSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  assetCount: z.number(),
}) satisfies z.ZodType<MediaFolderInfo>;

export const jobProgressSchema = z.object({
  jobId: z.string(),
  kind: z.enum(["import", "transcode"]),
  status: z.enum(["running", "done", "failed", "cancelled"]),
  done: z.number(),
  total: z.number(),
  fraction: z.number(),
  current: z.string().nullable(),
  results: z.array(
    z.object({
      name: z.string(),
      outcome: z.enum(["imported", "duplicate", "failed"]),
      assetId: z.string().nullable(),
      message: z.string().nullable(),
    }),
  ),
  error: z.string().nullable(),
}) satisfies z.ZodType<JobProgress>;

export const mediaListInputSchema = z.object({
  /** Omit for every folder; `null` for the root. */
  folderId: id.nullable().optional(),
  mediaType: mediaType.optional(),
  category: category.optional(),
  tag: z.string().max(40).optional(),
  query: z.string().max(200).optional(),
  favourite: z.boolean().optional(),
  missing: z.boolean().optional(),
  cursor: z.string().max(20).optional(),
  limit: z.int().min(1).max(200).default(60),
});

export const mediaListOutputSchema = z.object({
  items: z.array(mediaItemSchema),
  nextCursor: z.string().nullable(),
});

export const mediaImportInputSchema = z.object({
  /** Absolute paths from drag-and-drop (main re-checks them). */
  paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
  folderId: id.nullable().optional(),
  tags: tagList.optional(),
  licence: licenceSchema.nullable().optional(),
});

export const mediaUpdateInputSchema = z.object({
  id,
  patch: z
    .object({
      name: name.optional(),
      folderId: id.nullable().optional(),
      category: category.nullable().optional(),
      isFavourite: z.boolean().optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, "Nothing to update"),
});

export const idInputSchema = z.object({ id });
export const jobIdInputSchema = z.object({ jobId: z.string().min(1).max(64) });
export const setTagsInputSchema = z.object({ id, tags: tagList });
export const setLicenceInputSchema = z.object({
  id,
  licence: licenceSchema.nullable(),
});
export const createFolderInputSchema = z.object({
  name,
  parentId: id.nullable().optional(),
});
export const renameFolderInputSchema = z.object({ id, name });
export const chooseAndImportInputSchema = z
  .object({ folderId: id.nullable().optional() })
  .optional();
