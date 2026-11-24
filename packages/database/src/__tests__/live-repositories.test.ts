import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client";
import { newId } from "../ids";
import { createDisplayProfileRepository } from "../repositories/display-profile-repository";
import { createLiveSessionRepository } from "../repositories/live-session-repository";
import { createWorkspaceRepository } from "../repositories/workspace-repository";
import { openMigratedMemoryDb } from "./helpers";

let database: Database;
let churchId: string;
beforeEach(async () => {
  database = await openMigratedMemoryDb();
  churchId = newId();
  await createWorkspaceRepository(database).createWithOwner({
    churchId,
    churchName: "Grace",
    ownerDisplayName: "Owner",
  });
});
afterEach(() => database.close());

describe("display profile repository", () => {
  it("remembers a display once per fingerprint and updates it", async () => {
    const repo = createDisplayProfileRepository(database, churchId);
    const first = await repo.remember({
      fingerprint: "fp1",
      name: "Epson",
      width: 1920,
      height: 1080,
    });
    const again = await repo.remember({
      fingerprint: "fp1",
      name: "Epson EB",
      width: 1280,
      height: 720,
    });
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({
      name: "Epson EB",
      width: 1280,
      role: "main",
    });
    expect(await repo.list()).toHaveLength(1);
    expect(await repo.findByFingerprint("nope")).toBeNull();
  });
});

describe("live session repository", () => {
  it("journals a session and finds it until it ends", async () => {
    const repo = createLiveSessionRepository(database, churchId);
    const session = await repo.start({
      serviceId: null,
      displayProfileId: null,
    });
    await repo.save(session.id, {
      displayProfileId: null,
      currentItemId: "song-1",
      currentSlideIndex: 7,
      overlayStack: [{ kind: "scripture" }],
      playbackState: {
        assetId: "a",
        timeMs: 1200,
        paused: false,
        muted: false,
      },
    });
    expect(await repo.findUnfinished()).toMatchObject({
      id: session.id,
      currentItemId: "song-1",
      currentSlideIndex: 7,
      overlayStackJson: [{ kind: "scripture" }],
      playbackStateJson: { timeMs: 1200 },
    });
    await repo.end(session.id);
    expect(await repo.findUnfinished()).toBeNull();
    expect((await repo.get(session.id))?.endedAt).not.toBeNull();
  });
});
