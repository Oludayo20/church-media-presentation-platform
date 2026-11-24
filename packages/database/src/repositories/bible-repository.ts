import { eq, inArray } from "drizzle-orm";
import {
  AppError,
  type BibleBook,
  type BibleImportVerse,
  type BibleTranslation,
  type BibleVerse,
} from "@cmp/shared-types";
import type { Database } from "../client";
import { newId } from "../ids";
import {
  bibleBookAliases,
  bibleBooks,
  bibleTranslations,
  bibleVerses,
  scriptureCollections,
  scripturePassages,
} from "../schema";
import { toFtsQuery } from "./song-repository";

export function createBibleRepository(database: Database) {
  const { db, sqlite } = database;
  return {
    translations: () =>
      db.select().from(bibleTranslations).orderBy(bibleTranslations.name),
    async install(
      translation: BibleTranslation,
      verses: BibleImportVerse[],
    ): Promise<BibleTranslation> {
      return database.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(bibleTranslations)
          .where(eq(bibleTranslations.code, translation.code))
          .get();
        if (existing?.checksum === translation.checksum) return existing;
        if (existing)
          throw new AppError(
            "CONFLICT",
            `Translation ${translation.code} is already installed`,
          );
        await tx.insert(bibleTranslations).values(translation);
        const insertVerse = sqlite.prepare(
          "INSERT INTO bible_verses(book_id, chapter, verse, text) VALUES (?, ?, ?, ?)",
        );
        const books = new Map<
          string,
          { verses: BibleImportVerse[]; aliases: Set<string> }
        >();
        for (const verse of verses) {
          let book = books.get(verse.book);
          if (!book) {
            book = { verses: [], aliases: new Set() };
            books.set(verse.book, book);
          }
          book.verses.push(verse);
          for (const alias of verse.aliases ?? []) book.aliases.add(alias);
        }

        let position = 0;
        for (const [name, book] of books) {
          const { id } = (
            await tx
              .insert(bibleBooks)
              .values({
                translationCode: translation.code,
                name,
                position: position++,
              })
              .returning({ id: bibleBooks.id })
          )[0]!;
          for (const alias of book.aliases)
            await tx.insert(bibleBookAliases).values({ bookId: id, alias });
          const seen = new Set<string>();
          for (const verse of book.verses) {
            const key = `${verse.chapter}:${verse.verse}`;
            if (seen.has(key))
              throw new AppError(
                "VALIDATION_ERROR",
                `Duplicate verse ${name} ${key}`,
              );
            seen.add(key);
            insertVerse.run(id, verse.chapter, verse.verse, verse.text);
          }
        }
        return translation;
      });
    },

    async books(code: string): Promise<BibleBook[]> {
      const books = await db
        .select()
        .from(bibleBooks)
        .where(eq(bibleBooks.translationCode, code))
        .orderBy(bibleBooks.position);
      if (books.length === 0) return [];
      const aliases = await db
        .select()
        .from(bibleBookAliases)
        .where(
          inArray(
            bibleBookAliases.bookId,
            books.map(({ id }) => id),
          ),
        );
      return books.map(({ id, name, position }) => ({
        id,
        name,
        position,
        aliases: aliases
          .filter((alias) => alias.bookId === id)
          .map(({ alias }) => alias),
      }));
    },

    verses(bookId: number): Promise<BibleVerse[]> {
      return db
        .select({
          chapter: bibleVerses.chapter,
          verse: bibleVerses.verse,
          text: bibleVerses.text,
        })
        .from(bibleVerses)
        .where(eq(bibleVerses.bookId, bookId))
        .orderBy(bibleVerses.chapter, bibleVerses.verse)
        .all();
    },

    search(code: string, query: string) {
      const match = toFtsQuery(query);
      if (!match) return [];
      return sqlite
        .prepare(
          `
        SELECT b.name AS book, v.chapter, v.verse,
          snippet(bible_verses_fts, 0, char(1), char(2), '…', 18) AS snippet
        FROM bible_verses_fts
        JOIN bible_verses v ON v.id = bible_verses_fts.rowid
        JOIN bible_books b ON b.id = v.book_id
        WHERE bible_verses_fts MATCH ? AND b.translation_code = ?
        ORDER BY rank, b.position, v.chapter, v.verse LIMIT 40
      `,
        )
        .all(match, code) as {
        book: string;
        chapter: number;
        verse: number;
        snippet: string;
      }[];
    },

    collections: () =>
      db.select().from(scriptureCollections).orderBy(scriptureCollections.name),
    async createCollection(name: string) {
      const existing = await db
        .select()
        .from(scriptureCollections)
        .where(eq(scriptureCollections.name, name))
        .get();
      if (existing) return existing;
      const collection = { id: newId(), name };
      await db
        .insert(scriptureCollections)
        .values(collection)
        .onConflictDoNothing();
      return (await db
        .select()
        .from(scriptureCollections)
        .where(eq(scriptureCollections.name, name))
        .get())!;
    },
    saved: () =>
      db.select().from(scripturePassages).orderBy(scripturePassages.reference),
    async save(
      translationCode: string,
      reference: string,
      collectionId: string | null,
    ) {
      if (
        collectionId &&
        !(await db
          .select()
          .from(scriptureCollections)
          .where(eq(scriptureCollections.id, collectionId))
          .get())
      ) {
        throw new AppError("NOT_FOUND", "Scripture collection not found");
      }
      await db
        .insert(scripturePassages)
        .values({ id: newId(), translationCode, reference, collectionId })
        .onConflictDoNothing();
    },
    async remove(id: string) {
      await db.delete(scripturePassages).where(eq(scripturePassages.id, id));
    },
  };
}
