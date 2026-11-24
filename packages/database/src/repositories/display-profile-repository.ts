import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { newId, nowIso } from "../ids";
import { displayProfiles, type DisplayProfileRow } from "../schema";

export type DisplayProfile = DisplayProfileRow;

export interface RememberDisplayInput {
  fingerprint: string;
  name: string;
  width: number;
  height: number;
}

/** Remembered audience displays, matched by fingerprint on hot-plug. */
export function createDisplayProfileRepository(
  database: Database,
  churchId: string,
) {
  const { db } = database;

  async function findByFingerprint(
    fingerprint: string,
  ): Promise<DisplayProfile | null> {
    return (
      (await db.query.displayProfiles.findFirst({
        where: and(
          eq(displayProfiles.churchId, churchId),
          eq(displayProfiles.fingerprint, fingerprint),
        ),
      })) ?? null
    );
  }

  return {
    findByFingerprint,

    /** Most recently used first. */
    async list(): Promise<DisplayProfile[]> {
      return db
        .select()
        .from(displayProfiles)
        .where(eq(displayProfiles.churchId, churchId))
        .orderBy(desc(displayProfiles.lastUsedAt));
    },

    /** Creates or updates the profile for a display and marks it used now. */
    async remember(input: RememberDisplayInput): Promise<DisplayProfile> {
      const now = nowIso();
      await db
        .insert(displayProfiles)
        .values({
          id: newId(),
          churchId,
          fingerprint: input.fingerprint,
          name: input.name,
          width: input.width,
          height: input.height,
          role: "main",
          lastUsedAt: now,
        })
        .onConflictDoUpdate({
          target: [displayProfiles.churchId, displayProfiles.fingerprint],
          set: {
            name: input.name,
            width: input.width,
            height: input.height,
            lastUsedAt: now,
          },
        });
      const profile = await findByFingerprint(input.fingerprint);
      if (!profile) throw new Error("Display profile was not saved");
      return profile;
    },
  };
}

export type DisplayProfileRepository = ReturnType<
  typeof createDisplayProfileRepository
>;
