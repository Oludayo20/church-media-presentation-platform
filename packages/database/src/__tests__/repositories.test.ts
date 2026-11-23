import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@cmp/shared-types";
import type { Database } from "../client";
import { newId } from "../ids";
import { createMediaRepository } from "../repositories/media-repository";
import { createSettingsRepository } from "../repositories/settings-repository";
import { createWorkspaceRepository } from "../repositories/workspace-repository";
import { churches, slides, presentations } from "../schema";
import { openMigratedMemoryDb } from "./helpers";

let database: Database;
beforeEach(async () => {
  database = await openMigratedMemoryDb();
});
afterEach(() => database.close());

async function seedChurch(name = "Grace Chapel") {
  const churchId = newId();
  await createWorkspaceRepository(database).createWithOwner({
    churchId,
    churchName: name,
    ownerDisplayName: "Owner",
  });
  return churchId;
}

const logoInput = (churchId: string, checksum = "a".repeat(64)) => ({
  churchId,
  name: "logo.png",
  originalName: "logo.png",
  mediaType: "image" as const,
  category: "logo",
  mimeType: "image/png",
  filePath: `${checksum.slice(0, 2)}/${checksum}.png`,
  fileSize: 123,
  checksum,
});

describe("workspace repository", () => {
  it("creates a church with a single owner member", async () => {
    const repo = createWorkspaceRepository(database);
    const churchId = await seedChurch();
    expect(await repo.getChurch(churchId)).toMatchObject({
      id: churchId,
      name: "Grace Chapel",
      logoAssetId: null,
    });
    expect(await repo.owner(churchId)).toMatchObject({ displayName: "Owner" });
  });

  it("returns null for an unknown church", async () => {
    expect(
      await createWorkspaceRepository(database).getChurch(newId()),
    ).toBeNull();
  });

  it("rejects creating the same workspace twice and leaves no partial rows", async () => {
    const repo = createWorkspaceRepository(database);
    const churchId = await seedChurch();
    await expect(
      repo.createWithOwner({
        churchId,
        churchName: "Again",
        ownerDisplayName: "Owner 2",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const users = database.sqlite
      .prepare("SELECT count(*) AS n FROM users")
      .get();
    expect(users?.["n"]).toBe(1);
  });

  it("renames and bumps updatedAt", async () => {
    const repo = createWorkspaceRepository(database);
    const churchId = await seedChurch();
    const before = await repo.getChurch(churchId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const after = await repo.rename(churchId, "Grace Chapel Ikeja");
    expect(after.name).toBe("Grace Chapel Ikeja");
    expect(after.updatedAt > before!.updatedAt).toBe(true);
  });

  it("sets the logo only to this church's own asset", async () => {
    const repo = createWorkspaceRepository(database);
    const media = createMediaRepository(database);
    const churchId = await seedChurch();
    const otherChurch = await seedChurch("Other");
    const ownAsset = await media.createOrGet(logoInput(churchId));
    const foreignAsset = await media.createOrGet(
      logoInput(otherChurch, "b".repeat(64)),
    );

    expect((await repo.setLogo(churchId, ownAsset.id)).logoAssetId).toBe(
      ownAsset.id,
    );
    await expect(repo.setLogo(churchId, foreignAsset.id)).rejects.toThrow(
      AppError,
    );
    expect((await repo.setLogo(churchId, null)).logoAssetId).toBeNull();
  });

  it("enforces the member role CHECK constraint", () => {
    expect(() =>
      database.sqlite.exec(
        `INSERT INTO church_members (id, church_id, user_id, role, created_at)
         VALUES ('m', 'c', 'u', 'superuser', 'now')`,
      ),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe("media repository", () => {
  it("dedupes on (church, checksum)", async () => {
    const media = createMediaRepository(database);
    const churchId = await seedChurch();
    const first = await media.createOrGet(logoInput(churchId));
    const second = await media.createOrGet({
      ...logoInput(churchId),
      name: "renamed.png",
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("logo.png");
  });

  it("maps boolean and nullable columns", async () => {
    const media = createMediaRepository(database);
    const asset = await media.createOrGet(logoInput(await seedChurch()));
    expect(asset).toMatchObject({
      isFavourite: false,
      isMissing: false,
      durationMs: null,
      mediaType: "image",
    });
    expect(await media.findById(newId())).toBeNull();
  });
});

describe("cascades and constraints", () => {
  it("deleting a church cascades to presentations and slides", async () => {
    const churchId = await seedChurch();
    const now = new Date().toISOString();
    const presentationId = newId();
    await database.db.insert(presentations).values({
      id: presentationId,
      churchId,
      title: "Sunday",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(slides).values({
      id: newId(),
      presentationId,
      position: 0,
      slideType: "text",
      createdAt: now,
    });
    await expect(
      database.db.insert(slides).values({
        id: newId(),
        presentationId,
        position: 0,
        slideType: "text",
        createdAt: now,
      }),
    ).rejects.toMatchObject({
      // Drizzle wraps driver errors; the SQLite message is on `cause`.
      cause: expect.objectContaining({
        message: expect.stringMatching(/UNIQUE constraint failed/),
      }),
    });

    const { eq } = await import("drizzle-orm");
    await database.db.delete(churches).where(eq(churches.id, churchId));
    expect(await database.db.select().from(slides)).toEqual([]);
  });
});

describe("transactions", () => {
  it("roll back on throw", async () => {
    const churchId = newId();
    await expect(
      database.transaction(async (tx) => {
        const now = new Date().toISOString();
        await tx
          .insert(churches)
          .values({ id: churchId, name: "x", createdAt: now, updatedAt: now });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(
      await createWorkspaceRepository(database).getChurch(churchId),
    ).toBeNull();
  });

  it("are serialised, never interleaved", async () => {
    const order: string[] = [];
    const slow = (name: string) =>
      database.transaction(async () => {
        order.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`${name}:end`);
      });
    await Promise.all([slow("a"), slow("b")]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });
});

describe("settings repository", () => {
  const parseTheme = (value: unknown) => {
    if (value === "dark" || value === "light" || value === "system")
      return value;
    throw new Error("invalid theme");
  };
  const catalog = {
    "ui.theme": {
      default: "dark" as "dark" | "light" | "system",
      schema: { parse: parseTheme },
    },
    "display.safeAreaPct": {
      default: 5,
      schema: {
        parse: (value: unknown) => {
          if (typeof value !== "number" || value < 0 || value > 20)
            throw new Error("invalid pct");
          return value;
        },
      },
    },
  };

  it("returns defaults when nothing is stored", async () => {
    const repo = createSettingsRepository(database, await seedChurch(), catalog);
    expect(await repo.getAll()).toEqual({
      "ui.theme": "dark",
      "display.safeAreaPct": 5,
    });
  });

  it("round-trips typed values and upserts", async () => {
    const repo = createSettingsRepository(database, await seedChurch(), catalog);
    await repo.set("ui.theme", "light");
    await repo.set("ui.theme", "system");
    expect(await repo.get("ui.theme")).toBe("system");
    expect(
      database.sqlite.prepare("SELECT count(*) AS n FROM settings").get()?.[
        "n"
      ],
    ).toBe(1);
  });

  it("rejects invalid values on write", async () => {
    const repo = createSettingsRepository(database, await seedChurch(), catalog);
    await expect(
      repo.set("ui.theme", "purple" as "dark"),
    ).rejects.toThrow("invalid theme");
  });

  it("falls back to the default when a stored value is corrupt", async () => {
    const churchId = await seedChurch();
    const onInvalid = vi.fn();
    const repo = createSettingsRepository(database, churchId, catalog, {
      onInvalid,
    });
    database.sqlite
      .prepare("INSERT INTO settings VALUES (?, 'display.safeAreaPct', ?)")
      .run(churchId, "{not json");
    expect(await repo.get("display.safeAreaPct")).toBe(5);
    expect(onInvalid).toHaveBeenCalledWith(
      "display.safeAreaPct",
      expect.anything(),
    );
  });

  it("is scoped per church and reset restores the default", async () => {
    const a = createSettingsRepository(database, await seedChurch(), catalog);
    const b = createSettingsRepository(database, await seedChurch(), catalog);
    await a.set("display.safeAreaPct", 10);
    expect(await b.get("display.safeAreaPct")).toBe(5);
    expect(await a.reset("display.safeAreaPct")).toBe(5);
    expect(await a.get("display.safeAreaPct")).toBe(5);
  });
});
