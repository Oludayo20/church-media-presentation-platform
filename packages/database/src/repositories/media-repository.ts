import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { newId, nowIso } from "../ids";
import { mediaAssets, type MediaAssetRow } from "../schema";

export type MediaAsset = MediaAssetRow;

export interface CreateMediaAssetInput {
  churchId: string;
  name: string;
  originalName: string | null;
  mediaType: MediaAsset["mediaType"];
  category: string | null;
  mimeType: string;
  /** Relative to the workspace media directory. */
  filePath: string;
  fileSize: number;
  checksum: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  codec?: string | null;
  hasAudio?: boolean;
  thumbnailPath?: string | null;
  transcodeReason?: string | null;
  playbackWarning?: string | null;
  folderId?: string | null;
  fontFamily?: string | null;
}

/**
 * Media assets by id/checksum, and idempotent creation. The library views
 * (filters, tags, folders, licences, usage) are in media-library-repository.
 */
export function createMediaRepository(database: Database) {
  const { db } = database;

  async function findById(id: string): Promise<MediaAsset | null> {
    return (
      (await db.query.mediaAssets.findFirst({
        where: eq(mediaAssets.id, id),
      })) ?? null
    );
  }

  async function findByChecksum(
    churchId: string,
    checksum: string,
  ): Promise<MediaAsset | null> {
    return (
      (await db.query.mediaAssets.findFirst({
        where: and(
          eq(mediaAssets.churchId, churchId),
          eq(mediaAssets.checksum, checksum),
        ),
      })) ?? null
    );
  }

  return {
    findById,
    findByChecksum,

    async listByCategory(
      churchId: string,
      category: string,
    ): Promise<MediaAsset[]> {
      return db
        .select()
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.churchId, churchId),
            eq(mediaAssets.category, category),
          ),
        )
        .orderBy(mediaAssets.createdAt);
    },

    /**
     * Inserts an asset, or returns the existing one with the same checksum
     * (`UNIQUE(church_id, checksum)`): importing the same file twice is a
     * no-op (DOCUMENTATION.md §14 idempotency).
     */
    async createOrGet(input: CreateMediaAssetInput): Promise<MediaAsset> {
      const existing = await findByChecksum(input.churchId, input.checksum);
      if (existing) return existing;
      const timestamp = nowIso();
      const id = newId();
      await db.insert(mediaAssets).values({
        id,
        churchId: input.churchId,
        name: input.name,
        originalName: input.originalName,
        mediaType: input.mediaType,
        category: input.category,
        mimeType: input.mimeType,
        filePath: input.filePath,
        fileSize: input.fileSize,
        checksum: input.checksum,
        width: input.width ?? null,
        height: input.height ?? null,
        durationMs: input.durationMs ?? null,
        codec: input.codec ?? null,
        hasAudio: input.hasAudio ?? false,
        thumbnailPath: input.thumbnailPath ?? null,
        transcodeReason: input.transcodeReason ?? null,
        playbackWarning: input.playbackWarning ?? null,
        folderId: input.folderId ?? null,
        fontFamily: input.fontFamily ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const created = await findById(id);
      if (!created) throw new Error("Inserted media asset not found");
      return created;
    },
  };
}

export type MediaRepository = ReturnType<typeof createMediaRepository>;
