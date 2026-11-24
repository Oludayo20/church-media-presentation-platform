import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { newId, nowIso } from "../ids";
import { liveSessions, type LiveSessionRow } from "../schema";

export type LiveSessionRecord = LiveSessionRow;

export interface LiveSessionSnapshot {
  displayProfileId: string | null;
  currentItemId: string | null;
  currentSlideIndex: number;
  overlayStack: unknown[];
  playbackState: unknown;
}

/** The live-session journal (DOCUMENTATION.md §9.4). */
export function createLiveSessionRepository(
  database: Database,
  churchId: string,
) {
  const { db } = database;

  return {
    async start(input: {
      serviceId: string | null;
      displayProfileId: string | null;
    }): Promise<LiveSessionRecord> {
      const id = newId();
      const now = nowIso();
      await db.insert(liveSessions).values({
        id,
        churchId,
        serviceId: input.serviceId,
        displayProfileId: input.displayProfileId,
        startedAt: now,
        heartbeatAt: now,
      });
      const row = await db.query.liveSessions.findFirst({
        where: eq(liveSessions.id, id),
      });
      if (!row) throw new Error("Live session was not saved");
      return row;
    },

    async save(id: string, snapshot: LiveSessionSnapshot): Promise<void> {
      await db
        .update(liveSessions)
        .set({
          displayProfileId: snapshot.displayProfileId,
          currentItemId: snapshot.currentItemId,
          currentSlideIndex: snapshot.currentSlideIndex,
          overlayStackJson: snapshot.overlayStack,
          playbackStateJson: snapshot.playbackState ?? null,
          heartbeatAt: nowIso(),
        })
        .where(eq(liveSessions.id, id));
    },

    async end(id: string): Promise<string> {
      const endedAt = nowIso();
      await db
        .update(liveSessions)
        .set({ endedAt, heartbeatAt: endedAt })
        .where(eq(liveSessions.id, id));
      return endedAt;
    },

    /** The session a crash left running, if any (Phase 9 resume prompt). */
    async findUnfinished(): Promise<LiveSessionRecord | null> {
      return (
        (await db.query.liveSessions.findFirst({
          where: and(
            eq(liveSessions.churchId, churchId),
            isNull(liveSessions.endedAt),
          ),
          orderBy: desc(liveSessions.startedAt),
        })) ?? null
      );
    },

    async get(id: string): Promise<LiveSessionRecord | null> {
      return (
        (await db.query.liveSessions.findFirst({
          where: eq(liveSessions.id, id),
        })) ?? null
      );
    },
  };
}

export type LiveSessionRepository = ReturnType<
  typeof createLiveSessionRepository
>;
