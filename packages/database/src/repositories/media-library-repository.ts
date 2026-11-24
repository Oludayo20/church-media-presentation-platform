import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { AppError } from "@cmp/shared-types";
import type { Database } from "../client";
import { newId } from "../ids";
import type { LICENCE_TYPES } from "../schema";
import {
  churches,
  mediaAssets,
  mediaAssetTags,
  mediaFolders,
  mediaLicences,
  mediaTags,
  presentations,
  settings,
  slideObjects,
  slides,
  songs,
  type MediaAssetRow,
} from "../schema";

export type LicenceType = (typeof LICENCE_TYPES)[number];

export interface MediaLicence {
  licenceType: LicenceType;
  source: string | null;
  attribution: string | null;
  terms: string | null;
}

export interface LibraryAsset extends MediaAssetRow {
  tags: string[];
}

export interface LibraryFilter {
  /** `undefined` = every folder, `null` = the root (no folder). */
  folderId?: string | null | undefined;
  mediaType?: MediaAssetRow["mediaType"] | undefined;
  category?: string | undefined;
  tag?: string | undefined;
  query?: string | undefined;
  favourite?: boolean | undefined;
  missing?: boolean | undefined;
  limit: number;
  /** Opaque cursor from the previous page. */
  cursor?: string | undefined;
}

export interface LibraryPatch {
  name?: string;
  folderId?: string | null;
  category?: string | null;
  isFavourite?: boolean;
}

export interface MediaFolder {
  id: string;
  parentId: string | null;
  name: string;
  assetCount: number;
}

export interface MediaUsage {
  type: "church-logo" | "logo-screen" | "presentation" | "song" | "service";
  id: string;
  title: string;
}

/**
 * The media library (DOCUMENTATION.md §7, §12): filtered, paged listing,
 * folders, tags, licences, missing flags and the usage check that blocks
 * deleting an asset something still points at.
 */
export function createMediaLibraryRepository(
  database: Database,
  churchId: string,
) {
  const { db } = database;

  async function tagsFor(assetIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (assetIds.length === 0) return map;
    const rows = await db
      .select({ assetId: mediaAssetTags.assetId, name: mediaTags.name })
      .from(mediaAssetTags)
      .innerJoin(mediaTags, eq(mediaTags.id, mediaAssetTags.tagId))
      .where(inArray(mediaAssetTags.assetId, assetIds))
      .orderBy(asc(mediaTags.name));
    for (const row of rows)
      map.set(row.assetId, [...(map.get(row.assetId) ?? []), row.name]);
    return map;
  }

  async function requireAsset(id: string): Promise<MediaAssetRow> {
    const asset = await db.query.mediaAssets.findFirst({
      where: and(eq(mediaAssets.id, id), eq(mediaAssets.churchId, churchId)),
    });
    if (!asset) throw new AppError("NOT_FOUND", "Media not found");
    return asset;
  }

  async function requireFolder(id: string): Promise<void> {
    const folder = await db.query.mediaFolders.findFirst({
      where: and(eq(mediaFolders.id, id), eq(mediaFolders.churchId, churchId)),
    });
    if (!folder) throw new AppError("NOT_FOUND", "Folder not found");
  }

  /** Drops tags nothing uses any more. */
  async function pruneTags(): Promise<void> {
    await db
      .delete(mediaTags)
      .where(
        and(
          eq(mediaTags.churchId, churchId),
          sql`${mediaTags.id} NOT IN (SELECT ${mediaAssetTags.tagId} FROM ${mediaAssetTags})`,
        ),
      );
  }

  async function get(id: string): Promise<LibraryAsset | null> {
    const asset = await db.query.mediaAssets.findFirst({
      where: and(eq(mediaAssets.id, id), eq(mediaAssets.churchId, churchId)),
    });
    if (!asset) return null;
    return { ...asset, tags: (await tagsFor([id])).get(id) ?? [] };
  }

  return {
    get,

    async list(
      filter: LibraryFilter,
    ): Promise<{ items: LibraryAsset[]; nextCursor: string | null }> {
      const where: SQL[] = [
        eq(mediaAssets.churchId, churchId),
        isNull(mediaAssets.archivedAt),
      ];
      if (filter.folderId === null) where.push(isNull(mediaAssets.folderId));
      else if (filter.folderId)
        where.push(eq(mediaAssets.folderId, filter.folderId));
      if (filter.mediaType)
        where.push(eq(mediaAssets.mediaType, filter.mediaType));
      if (filter.category)
        where.push(eq(mediaAssets.category, filter.category));
      if (filter.favourite) where.push(eq(mediaAssets.isFavourite, true));
      if (filter.missing) where.push(eq(mediaAssets.isMissing, true));
      if (filter.query?.trim()) {
        const pattern = `%${filter.query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(
          or(
            sql`${mediaAssets.name} LIKE ${pattern} ESCAPE '\\'`,
            sql`${mediaAssets.originalName} LIKE ${pattern} ESCAPE '\\'`,
          )!,
        );
      }
      if (filter.tag) {
        where.push(
          sql`${mediaAssets.id} IN (SELECT ${mediaAssetTags.assetId} FROM ${mediaAssetTags}
              JOIN ${mediaTags} ON ${mediaTags.id} = ${mediaAssetTags.tagId}
              WHERE ${mediaTags.churchId} = ${churchId} AND ${mediaTags.name} = ${filter.tag})`,
        );
      }
      const offset = Math.max(0, Number(filter.cursor ?? 0) || 0);
      const rows = await db
        .select()
        .from(mediaAssets)
        .where(and(...where))
        .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
        .limit(filter.limit + 1)
        .offset(offset);
      const page = rows.slice(0, filter.limit);
      const tags = await tagsFor(page.map((row) => row.id));
      return {
        items: page.map((row) => ({ ...row, tags: tags.get(row.id) ?? [] })),
        nextCursor:
          rows.length > filter.limit ? String(offset + filter.limit) : null,
      };
    },

    async all(): Promise<MediaAssetRow[]> {
      return db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.churchId, churchId));
    },

    async update(id: string, patch: LibraryPatch): Promise<LibraryAsset> {
      await requireAsset(id);
      if (patch.folderId) await requireFolder(patch.folderId);
      const values: Partial<MediaAssetRow> = {
        updatedAt: new Date().toISOString(),
      };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.folderId !== undefined) values.folderId = patch.folderId;
      if (patch.category !== undefined) values.category = patch.category;
      if (patch.isFavourite !== undefined)
        values.isFavourite = patch.isFavourite;
      await db.update(mediaAssets).set(values).where(eq(mediaAssets.id, id));
      return (await get(id))!;
    },

    /** Records probe/thumbnail results after a background job. */
    async updateMetadata(
      id: string,
      values: Partial<
        Pick<
          MediaAssetRow,
          | "durationMs"
          | "width"
          | "height"
          | "codec"
          | "hasAudio"
          | "thumbnailPath"
          | "transcodeReason"
          | "playbackWarning"
        >
      >,
    ): Promise<void> {
      await db.update(mediaAssets).set(values).where(eq(mediaAssets.id, id));
    },

    async remove(id: string): Promise<MediaAssetRow> {
      const asset = await requireAsset(id);
      await db.delete(mediaAssets).where(eq(mediaAssets.id, id));
      await pruneTags();
      return asset;
    },

    /** Replaces an asset's tags, creating tags as needed. */
    async setTags(id: string, names: string[]): Promise<LibraryAsset> {
      await requireAsset(id);
      const clean = [
        ...new Set(names.map((name) => name.trim()).filter(Boolean)),
      ];
      await database.transaction(async (tx) => {
        await tx.delete(mediaAssetTags).where(eq(mediaAssetTags.assetId, id));
        for (const name of clean) {
          await tx
            .insert(mediaTags)
            .values({ id: newId(), churchId, name })
            .onConflictDoNothing();
          const tag = await tx.query.mediaTags.findFirst({
            where: and(
              eq(mediaTags.churchId, churchId),
              eq(mediaTags.name, name),
            ),
          });
          await tx
            .insert(mediaAssetTags)
            .values({ assetId: id, tagId: tag!.id })
            .onConflictDoNothing();
        }
      });
      await pruneTags();
      return (await get(id))!;
    },

    async tags(): Promise<{ name: string; count: number }[]> {
      return db
        .select({ name: mediaTags.name, count: count(mediaAssetTags.assetId) })
        .from(mediaTags)
        .leftJoin(mediaAssetTags, eq(mediaAssetTags.tagId, mediaTags.id))
        .where(eq(mediaTags.churchId, churchId))
        .groupBy(mediaTags.id)
        .orderBy(asc(mediaTags.name));
    },

    async folders(): Promise<MediaFolder[]> {
      const rows = await db
        .select({
          id: mediaFolders.id,
          parentId: mediaFolders.parentId,
          name: mediaFolders.name,
          assetCount: count(mediaAssets.id),
        })
        .from(mediaFolders)
        .leftJoin(mediaAssets, eq(mediaAssets.folderId, mediaFolders.id))
        .where(eq(mediaFolders.churchId, churchId))
        .groupBy(mediaFolders.id)
        .orderBy(asc(mediaFolders.name));
      return rows;
    },

    async createFolder(
      name: string,
      parentId: string | null,
    ): Promise<MediaFolder> {
      if (parentId) await requireFolder(parentId);
      const id = newId();
      await db.insert(mediaFolders).values({ id, churchId, name, parentId });
      return { id, parentId, name, assetCount: 0 };
    },

    async renameFolder(id: string, name: string): Promise<void> {
      await requireFolder(id);
      await db
        .update(mediaFolders)
        .set({ name })
        .where(eq(mediaFolders.id, id));
    },

    /** Subfolders go with it; assets fall back to the root (FK SET NULL). */
    async deleteFolder(id: string): Promise<void> {
      await requireFolder(id);
      await db.delete(mediaFolders).where(eq(mediaFolders.id, id));
    },

    async licence(id: string): Promise<MediaLicence | null> {
      const row = await db.query.mediaLicences.findFirst({
        where: eq(mediaLicences.assetId, id),
      });
      return row
        ? {
            licenceType: row.licenceType,
            source: row.source,
            attribution: row.attribution,
            terms: row.terms,
          }
        : null;
    },

    async setLicence(id: string, licence: MediaLicence | null): Promise<void> {
      await requireAsset(id);
      if (!licence) {
        await db.delete(mediaLicences).where(eq(mediaLicences.assetId, id));
        return;
      }
      await db
        .insert(mediaLicences)
        .values({ id: newId(), assetId: id, ...licence })
        .onConflictDoUpdate({ target: mediaLicences.assetId, set: licence });
    },

    /**
     * Fonts the church has confirmed it may use (a licence other than
     * "unknown" is recorded) and that are present on disk.
     */
    async licensedFonts(): Promise<
      { id: string; family: string; name: string; mimeType: string | null }[]
    > {
      return database.sqlite
        .prepare(
          `SELECT a.id, a.font_family AS family, a.name, a.mime_type
             FROM media_assets a JOIN media_licences l ON l.asset_id = a.id
            WHERE a.church_id = ? AND a.media_type = 'font' AND a.font_family IS NOT NULL
              AND a.is_missing = 0 AND a.archived_at IS NULL AND l.licence_type <> 'unknown'
            ORDER BY a.font_family`,
        )
        .all(churchId)
        .map((row) => ({
          id: String(row["id"]),
          family: String(row["family"]),
          name: String(row["name"]),
          mimeType: row["mime_type"] === null ? null : String(row["mime_type"]),
        }));
    },

    /** Sets `is_missing` exactly for `missingIds`, clears it elsewhere. */
    async markMissing(missingIds: string[]): Promise<void> {
      await database.transaction(async (tx) => {
        await tx
          .update(mediaAssets)
          .set({ isMissing: false })
          .where(eq(mediaAssets.churchId, churchId));
        if (missingIds.length > 0) {
          await tx
            .update(mediaAssets)
            .set({ isMissing: true })
            .where(inArray(mediaAssets.id, missingIds));
        }
      });
    },

    /** Everything that still points at an asset; non-empty blocks deletion. */
    async usage(id: string): Promise<MediaUsage[]> {
      const used: MediaUsage[] = [];
      const church = await db.query.churches.findFirst({
        where: eq(churches.id, churchId),
      });
      if (church?.logoAssetId === id)
        used.push({ type: "church-logo", id: churchId, title: "Church logo" });
      const logoSetting = await db.query.settings.findFirst({
        where: and(
          eq(settings.churchId, churchId),
          eq(settings.key, "live.logoAssetId"),
        ),
      });
      if (logoSetting?.valueJson === JSON.stringify(id)) {
        used.push({
          type: "logo-screen",
          id: "live.logoAssetId",
          title: "Logo screen",
        });
      }
      const decks = await db
        .selectDistinct({ id: presentations.id, title: presentations.title })
        .from(presentations)
        .innerJoin(slides, eq(slides.presentationId, presentations.id))
        .leftJoin(slideObjects, eq(slideObjects.slideId, slides.id))
        .where(
          and(
            eq(presentations.churchId, churchId),
            or(
              eq(slides.backgroundValue, id),
              like(slideObjects.propertiesJson, `%${id}%`),
            ),
          ),
        );
      for (const deck of decks)
        used.push({ type: "presentation", id: deck.id, title: deck.title });
      const songRows = await db
        .select({ id: songs.id, title: songs.title })
        .from(songs)
        .where(
          and(
            eq(songs.churchId, churchId),
            eq(songs.defaultBackgroundAssetId, id),
          ),
        );
      for (const song of songRows) {
        used.push({ type: "song", id: song.id, title: `Song: ${song.title}` });
      }
      const serviceRows = database.sqlite
        .prepare(
          `SELECT DISTINCT s.id, s.title FROM service_items i JOIN services s ON s.id = i.service_id
            WHERE s.church_id = ? AND i.ref_id = ?`,
        )
        .all(churchId, id);
      for (const row of serviceRows) {
        used.push({ type: "service", id: String(row["id"]), title: `Service: ${String(row["title"])}` });
      }
      return used;
    },
  };
}

export type MediaLibraryRepository = ReturnType<
  typeof createMediaLibraryRepository
>;
