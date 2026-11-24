import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { AppError } from "@cmp/shared-types";
import type { Database } from "../client";
import { newId, nowIso } from "../ids";
import type { SONG_SECTION_TYPES } from "../schema";
import {
  songArrangements,
  songCollectionItems,
  songCollections,
  songs,
  songSections,
} from "../schema";

export type SongSectionType = (typeof SONG_SECTION_TYPES)[number];

export interface SongSplit {
  mode: "lines" | "chars";
  linesPerSlide: number;
  maxChars: number;
  blankBetweenSections: boolean;
}

export interface SongSectionInput {
  id: string;
  type: SongSectionType;
  label: string;
  lyrics: string;
}

export interface SongInput {
  title: string;
  artist: string | null;
  language: string;
  category: string | null;
  copyrightOwner: string | null;
  copyrightYear: number | null;
  ccliNumber: string | null;
  licenceReference: string | null;
  tags: string[];
  collectionIds: string[];
  backgroundAssetId: string | null;
  templateId: string | null;
  split: SongSplit | null;
  sections: SongSectionInput[];
  /** Section ids of the default arrangement (repeats allowed). */
  arrangement: string[];
}

export interface SongRecord extends SongInput {
  id: string;
  isFavourite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SongSummary {
  id: string;
  title: string;
  artist: string | null;
  language: string;
  sectionCount: number;
  /** Lyric excerpt with «matches», when searching. */
  snippet: string | null;
}

export interface SongSearch {
  query?: string | undefined;
  collectionId?: string | undefined;
  language?: string | undefined;
  limit: number;
}

/**
 * FTS5 query from user text: every word must match, as a prefix, so
 * "amaz gra" finds "Amazing Grace". Quoting each token neutralises FTS
 * operators (`OR`, `NEAR`, `*`, `"`) typed by the user.
 */
export function toFtsQuery(text: string): string | null {
  const tokens = text.normalize("NFKC").match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  if (tokens.length === 0) return null;
  return tokens
    .slice(0, 12)
    .map((token) => `"${token}"*`)
    .join(" ");
}

/**
 * Songs, sections, the default arrangement, collections and the
 * `songs_fts` index (DOCUMENTATION.md §5, §12). Every write replaces the
 * song's sections/arrangement/links and its FTS row in one transaction.
 */
export function createSongRepository(database: Database, churchId: string) {
  const { db, sqlite } = database;

  function validate(input: SongInput): void {
    const ids = input.sections.map((section) => section.id);
    if (new Set(ids).size !== ids.length)
      throw new AppError("VALIDATION_ERROR", "Two sections share an id");
  }

  function writeFts(id: string, input: SongInput): void {
    sqlite.prepare("DELETE FROM songs_fts WHERE song_id = ?").run(id);
    sqlite
      .prepare(
        "INSERT INTO songs_fts (song_id, title, artist, lyrics_plain, tags) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.title,
        input.artist ?? "",
        input.sections
          .map((section) => section.lyrics.replace(/\s+/g, " "))
          .join(" "),
        input.tags.join(" "),
      );
  }

  async function writeChildren(
    tx: Database["db"],
    id: string,
    input: SongInput,
  ): Promise<void> {
    await tx.delete(songSections).where(eq(songSections.songId, id));
    await tx.delete(songArrangements).where(eq(songArrangements.songId, id));
    await tx
      .delete(songCollectionItems)
      .where(eq(songCollectionItems.songId, id));
    for (const [order, section] of input.sections.entries()) {
      await tx.insert(songSections).values({
        id: section.id,
        songId: id,
        sectionType: section.type,
        label: section.label,
        sectionOrder: order,
        lyrics: section.lyrics,
      });
    }
    const known = new Set(input.sections.map((section) => section.id));
    await tx.insert(songArrangements).values({
      id: newId(),
      songId: id,
      name: "Default",
      sectionIdsJson: input.arrangement.filter((sectionId) =>
        known.has(sectionId),
      ),
      isDefault: true,
    });
    if (input.collectionIds.length > 0) {
      const valid = await tx
        .select({ id: songCollections.id })
        .from(songCollections)
        .where(
          and(
            eq(songCollections.churchId, churchId),
            inArray(songCollections.id, input.collectionIds),
          ),
        );
      for (const { id: collectionId } of valid) {
        await tx
          .insert(songCollectionItems)
          .values({ collectionId, songId: id })
          .onConflictDoNothing();
      }
    }
    writeFts(id, input);
  }

  function columns(input: SongInput) {
    return {
      title: input.title,
      artist: input.artist,
      language: input.language,
      category: input.category,
      copyrightOwner: input.copyrightOwner,
      copyrightYear: input.copyrightYear,
      ccliNumber: input.ccliNumber,
      licenceReference: input.licenceReference,
      defaultBackgroundAssetId: input.backgroundAssetId,
      defaultTemplateId: input.templateId,
      tagsJson: input.tags,
      splitJson: input.split,
    };
  }

  async function get(id: string): Promise<SongRecord | null> {
    const row = await db.query.songs.findFirst({
      where: and(
        eq(songs.id, id),
        eq(songs.churchId, churchId),
        isNull(songs.archivedAt),
      ),
    });
    if (!row) return null;
    const [sections, arrangement, links] = await Promise.all([
      db
        .select()
        .from(songSections)
        .where(eq(songSections.songId, id))
        .orderBy(asc(songSections.sectionOrder)),
      db.query.songArrangements.findFirst({
        where: and(
          eq(songArrangements.songId, id),
          eq(songArrangements.isDefault, true),
        ),
      }),
      db
        .select()
        .from(songCollectionItems)
        .where(eq(songCollectionItems.songId, id)),
    ]);
    return {
      id: row.id,
      isFavourite: row.isFavourite,
      title: row.title,
      artist: row.artist,
      language: row.language,
      category: row.category,
      copyrightOwner: row.copyrightOwner,
      copyrightYear: row.copyrightYear,
      ccliNumber: row.ccliNumber,
      licenceReference: row.licenceReference,
      tags: row.tagsJson,
      collectionIds: links.map((link) => link.collectionId),
      backgroundAssetId: row.defaultBackgroundAssetId,
      templateId: row.defaultTemplateId,
      split: (row.splitJson as SongSplit | null) ?? null,
      sections: sections.map((section) => ({
        id: section.id,
        type: section.sectionType,
        label: section.label,
        lyrics: section.lyrics,
      })),
      arrangement:
        arrangement?.sectionIdsJson ?? sections.map((section) => section.id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    get,

    async create(input: SongInput, id: string = newId()): Promise<SongRecord> {
      validate(input);
      const timestamp = nowIso();
      await database.transaction(async (tx) => {
        await tx.insert(songs).values({
          id,
          churchId,
          ...columns(input),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await writeChildren(tx, id, input);
      });
      return (await get(id))!;
    },

    async update(id: string, input: SongInput): Promise<SongRecord> {
      validate(input);
      if (!(await get(id))) throw new AppError("NOT_FOUND", "Song not found");
      await database.transaction(async (tx) => {
        await tx
          .update(songs)
          .set({ ...columns(input), updatedAt: nowIso() })
          .where(eq(songs.id, id));
        await writeChildren(tx, id, input);
      });
      return (await get(id))!;
    },

    async delete(id: string): Promise<void> {
      if (!(await get(id))) throw new AppError("NOT_FOUND", "Song not found");
      // §8.1: a song a service still uses cannot be deleted.
      const usedBy = sqlite
        .prepare(
          `SELECT DISTINCT s.id, s.title FROM service_items i JOIN services s ON s.id = i.service_id
            WHERE s.church_id = ? AND i.ref_id = ?`,
        )
        .all(churchId, id)
        .map((row) => ({ id: String(row["id"]), title: String(row["title"]) }));
      if (usedBy.length > 0) {
        throw new AppError(
          "CONFLICT",
          `Used in ${usedBy.length} service${usedBy.length === 1 ? "" : "s"}. Remove it from the service${usedBy.length === 1 ? "" : "s"} first.`,
          { usedBy },
        );
      }
      await database.transaction(async (tx) => {
        sqlite.prepare("DELETE FROM songs_fts WHERE song_id = ?").run(id);
        await tx.delete(songs).where(eq(songs.id, id));
      });
    },

    async setFavourite(id: string, favourite: boolean): Promise<void> {
      if (!(await get(id))) throw new AppError("NOT_FOUND", "Song not found");
      await db.update(songs).set({ isFavourite: favourite }).where(eq(songs.id, id));
    },

    async favourites(limit: number): Promise<{ id: string; title: string; artist: string | null }[]> {
      return db
        .select({ id: songs.id, title: songs.title, artist: songs.artist })
        .from(songs)
        .where(and(eq(songs.churchId, churchId), eq(songs.isFavourite, true), isNull(songs.archivedAt)))
        .orderBy(asc(songs.title))
        .limit(limit);
    },

    async isFavourite(id: string): Promise<boolean> {
      const row = await db.query.songs.findFirst({ where: eq(songs.id, id), columns: { isFavourite: true } });
      return row?.isFavourite ?? false;
    },

    /**
     * Without a query: alphabetical. With one: FTS5 ranked by
     * `bm25(songs_fts, 0, 10, 3, 1, 2)` — title ≫ artist > tags > lyrics
     * (§5.3; the first weight is the unindexed song_id).
     */
    async search(search: SongSearch): Promise<SongSummary[]> {
      const fts = search.query ? toFtsQuery(search.query) : null;
      const where: string[] = ["s.church_id = ?", "s.archived_at IS NULL"];
      const params: (string | number)[] = [churchId];
      if (search.language) {
        where.push("s.language = ?");
        params.push(search.language);
      }
      if (search.collectionId) {
        where.push(
          "s.id IN (SELECT song_id FROM song_collection_items WHERE collection_id = ?)",
        );
        params.push(search.collectionId);
      }
      const sectionCount =
        "(SELECT count(*) FROM song_sections WHERE song_id = s.id)";
      const rows = fts
        ? sqlite
            .prepare(
              `SELECT s.id, s.title, s.artist, s.language, ${sectionCount} AS section_count,
                      snippet(songs_fts, 3, '«', '»', '…', 10) AS snippet
                 FROM songs_fts JOIN songs s ON s.id = songs_fts.song_id
                WHERE songs_fts MATCH ? AND ${where.join(" AND ")}
                ORDER BY bm25(songs_fts, 0.0, 10.0, 3.0, 1.0, 2.0), s.title
                LIMIT ?`,
            )
            .all(fts, ...params, search.limit)
        : sqlite
            .prepare(
              `SELECT s.id, s.title, s.artist, s.language, ${sectionCount} AS section_count, NULL AS snippet
                 FROM songs s WHERE ${where.join(" AND ")}
                ORDER BY s.title COLLATE NOCASE LIMIT ?`,
            )
            .all(...params, search.limit);
      return rows.map((row) => ({
        id: String(row["id"]),
        title: String(row["title"]),
        artist: row["artist"] === null ? null : String(row["artist"]),
        language: String(row["language"]),
        sectionCount: Number(row["section_count"]),
        snippet:
          row["snippet"] === null || !String(row["snippet"]).includes("«")
            ? null
            : String(row["snippet"]),
      }));
    },

    async collections(): Promise<
      { id: string; name: string; songCount: number }[]
    > {
      return sqlite
        .prepare(
          `SELECT c.id, c.name, (SELECT count(*) FROM song_collection_items i WHERE i.collection_id = c.id) AS song_count
             FROM song_collections c WHERE c.church_id = ? ORDER BY c.position, c.name`,
        )
        .all(churchId)
        .map((row) => ({
          id: String(row["id"]),
          name: String(row["name"]),
          songCount: Number(row["song_count"]),
        }));
    },

    /** Creates the built-in collections once (idempotent). */
    async ensureCollections(names: readonly string[]): Promise<void> {
      for (const [position, name] of names.entries()) {
        await db
          .insert(songCollections)
          .values({ id: newId(), churchId, name, position })
          .onConflictDoNothing();
      }
    },

    async createCollection(
      name: string,
    ): Promise<{ id: string; name: string; songCount: number }> {
      const existing = await db.query.songCollections.findFirst({
        where: and(
          eq(songCollections.churchId, churchId),
          eq(songCollections.name, name),
        ),
      });
      if (existing)
        throw new AppError("CONFLICT", "A collection with that name exists");
      const id = newId();
      await db
        .insert(songCollections)
        .values({ id, churchId, name, position: 1000 });
      return { id, name, songCount: 0 };
    },

    /** Songs whose default background is this media asset (delete guard). */
    async usingBackground(
      assetId: string,
    ): Promise<{ id: string; title: string }[]> {
      return db
        .select({ id: songs.id, title: songs.title })
        .from(songs)
        .where(
          and(
            eq(songs.churchId, churchId),
            eq(songs.defaultBackgroundAssetId, assetId),
          ),
        );
    },
  };
}

export type SongRepository = ReturnType<typeof createSongRepository>;
