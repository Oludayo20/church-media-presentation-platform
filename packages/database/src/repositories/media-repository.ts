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
}

/**
 * Minimal media repository: enough for the onboarding logo and the
 * `cmp-media://` protocol. The full library (folders, tags, licences,
 * missing-file scans) is Phase 4.
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
