import { eq } from "drizzle-orm";
import { AppError } from "@cmp/shared-types";
import type { Database } from "../client";
import { newId, nowIso } from "../ids";
import { churches, churchMembers, mediaAssets, users } from "../schema";

export interface Church {
  id: string;
  name: string;
  logoAssetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceInput {
  /** Also the workspace directory name, so it is chosen by the caller. */
  churchId: string;
  churchName: string;
  ownerDisplayName: string;
}

/**
 * The workspace is one church plus its members. The MVP has a single local
 * Owner; the role model exists from day one (DOCUMENTATION.md §17.2).
 */
export function createWorkspaceRepository(database: Database) {
  const { db } = database;

  async function getChurch(id: string): Promise<Church | null> {
    const row = await db.query.churches.findFirst({
      where: eq(churches.id, id),
    });
    return row ? toChurch(row) : null;
  }

  async function requireChurch(id: string): Promise<Church> {
    const church = await getChurch(id);
    if (!church) throw new AppError("NOT_FOUND", "Workspace not found");
    return church;
  }

  return {
    getChurch,

    async createWithOwner(input: CreateWorkspaceInput): Promise<Church> {
      return database.transaction(async (tx) => {
        const existing = await tx.query.churches.findFirst({
          where: eq(churches.id, input.churchId),
        });
        if (existing) {
          throw new AppError("CONFLICT", "Workspace already exists");
        }
        const timestamp = nowIso();
        const userId = newId();
        await tx.insert(churches).values({
          id: input.churchId,
          name: input.churchName,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await tx.insert(users).values({
          id: userId,
          displayName: input.ownerDisplayName,
          createdAt: timestamp,
        });
        await tx.insert(churchMembers).values({
          id: newId(),
          churchId: input.churchId,
          userId,
          role: "owner",
          createdAt: timestamp,
        });
        return requireChurch(input.churchId);
      });
    },

    async rename(id: string, name: string): Promise<Church> {
      await requireChurch(id);
      await db
        .update(churches)
        .set({ name, updatedAt: nowIso() })
        .where(eq(churches.id, id));
      return requireChurch(id);
    },

    /** Points the logo at one of this church's media assets, or clears it. */
    async setLogo(id: string, assetId: string | null): Promise<Church> {
      await requireChurch(id);
      if (assetId !== null) {
        const asset = await db.query.mediaAssets.findFirst({
          where: eq(mediaAssets.id, assetId),
        });
        if (!asset || asset.churchId !== id) {
          throw new AppError("NOT_FOUND", "Logo asset not found");
        }
      }
      await db
        .update(churches)
        .set({ logoAssetId: assetId, updatedAt: nowIso() })
        .where(eq(churches.id, id));
      return requireChurch(id);
    },

    async owner(churchId: string) {
      const member = await db.query.churchMembers.findFirst({
        where: (m, { and }) =>
          and(eq(m.churchId, churchId), eq(m.role, "owner")),
      });
      if (!member) return null;
      return (
        (await db.query.users.findFirst({
          where: eq(users.id, member.userId),
        })) ?? null
      );
    },
  };
}

export type WorkspaceRepository = ReturnType<typeof createWorkspaceRepository>;

function toChurch(row: typeof churches.$inferSelect): Church {
  return {
    id: row.id,
    name: row.name,
    logoAssetId: row.logoAssetId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
