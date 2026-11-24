import { z } from "zod";
import type {
  SongCollectionInfo,
  SongData,
  SongDetail,
  SongListItem,
  SongSectionTypeName,
} from "@cmp/shared-types";
import { songSplitSchema } from "../settings-catalog";

export const SONG_SECTION_TYPES = [
  "intro",
  "verse",
  "pre_chorus",
  "chorus",
  "bridge",
  "refrain",
  "tag",
  "outro",
] as const satisfies readonly SongSectionTypeName[];

/** The seven built-in collections (docs/TASKS.md Phase 5). */
export const DEFAULT_SONG_COLLECTIONS = [
  "Praise",
  "Worship",
  "Hymns",
  "Communion",
  "Christmas",
  "Easter",
  "Nigerian gospel",
] as const;

export const SONG_LANGUAGES = {
  en: "English",
  yo: "Yorùbá",
  ig: "Igbo",
  ha: "Hausa",
  pcm: "Naijá (Pidgin)",
  fr: "French",
} as const;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");
const optionalText = (max: number) => z.string().trim().max(max).nullable();

export const songSectionSchema = z.object({
  id,
  type: z.enum(SONG_SECTION_TYPES),
  label: z.string().trim().min(1, "Name the section").max(40),
  lyrics: z.string().max(10_000),
});

export const songDataSchema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(200),
  artist: optionalText(200),
  language: z.string().trim().min(2).max(12),
  category: optionalText(60),
  copyrightOwner: optionalText(200),
  copyrightYear: z.int().min(1000).max(2200).nullable(),
  ccliNumber: z
    .string()
    .trim()
    .regex(/^\d{1,12}$/, "CCLI numbers are digits only")
    .nullable(),
  licenceReference: optionalText(200),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  collectionIds: z.array(id).max(50),
  backgroundAssetId: id.nullable(),
  templateId: z.string().max(40).nullable(),
  split: songSplitSchema.nullable(),
  sections: z.array(songSectionSchema).max(60),
  arrangement: z.array(id).max(200),
}) satisfies z.ZodType<SongData, z.input<z.ZodType>>;

export const songDetailSchema = songDataSchema.extend({
  id: z.string(),
  isFavourite: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<SongDetail, z.input<z.ZodType>>;

export const songListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string().nullable(),
  language: z.string(),
  sectionCount: z.number(),
  snippet: z.string().nullable(),
}) satisfies z.ZodType<SongListItem>;

export const songCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  songCount: z.number(),
}) satisfies z.ZodType<SongCollectionInfo>;

export const songListInputSchema = z.object({
  query: z.string().max(200).optional(),
  collectionId: id.optional(),
  language: z.string().max(12).optional(),
  limit: z.int().min(1).max(500).default(200),
});

export const parsedLyricsSchema = z.object({
  sections: z.array(songSectionSchema),
  arrangement: z.array(z.string()),
});

export const songImportResultSchema = z.object({
  imported: z.array(songListItemSchema),
  failed: z.array(z.object({ name: z.string(), message: z.string() })),
});
