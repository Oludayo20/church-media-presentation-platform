import { z } from "zod";

const text = (length: number) => z.string().trim().min(1).max(length);
export const bibleCodeSchema = z.string().regex(/^[A-Z0-9_-]{1,16}$/u);
export const bibleTranslationSchema = z.object({
  code: bibleCodeSchema,
  name: text(150),
  language: text(35),
  licence: text(250),
  attribution: text(1000),
  versification: text(100),
  checksum: z.string().regex(/^[0-9a-f]{64}$/u),
});
export const bibleVerseSchema = z.object({
  chapter: z.int().min(1).max(200),
  verse: z.int().min(1).max(300),
  text: text(6000).refine(
    (value) =>
      !["\u0000", "\u0001", "\u0002"].some((character) =>
        value.includes(character),
      ),
    "Unexpected control character",
  ),
});
export const bibleImportVerseSchema = bibleVerseSchema.extend({
  book: text(100),
  aliases: z.array(text(100)).max(50).optional(),
});
export const bibleBookSchema = z.object({
  id: z.int().positive(),
  name: z.string(),
  position: z.int(),
  aliases: z.array(z.string()),
});
export const scriptureRequestSchema = z.object({
  code: bibleCodeSchema,
  reference: text(300),
});
export const scriptureCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
});
