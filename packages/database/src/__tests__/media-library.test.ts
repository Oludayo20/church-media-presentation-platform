import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client";
import { newId } from "../ids";
import {
  createMediaLibraryRepository,
  type MediaLibraryRepository,
} from "../repositories/media-library-repository";
import { createMediaRepository } from "../repositories/media-repository";
import { createSettingsRepository } from "../repositories/settings-repository";
import { createWorkspaceRepository } from "../repositories/workspace-repository";
import { presentations, slideObjects, slides } from "../schema";
import { openMigratedMemoryDb } from "./helpers";

let database: Database;
let churchId: string;
let library: MediaLibraryRepository;

beforeEach(async () => {
  database = await openMigratedMemoryDb();
  churchId = newId();
  await createWorkspaceRepository(database).createWithOwner({
    churchId,
    churchName: "G",
    ownerDisplayName: "O",
  });
  library = createMediaLibraryRepository(database, churchId);
});
afterEach(() => database.close());

let n = 0;
async function asset(
  name: string,
  mediaType: "image" | "video" = "image",
  extra = {},
) {
  n += 1;
  const checksum = String(n).padStart(64, "0");
  return createMediaRepository(database).createOrGet({
    churchId,
    name,
    originalName: name,
    mediaType,
    category: mediaType === "video" ? "motion_background" : "flyer",
    mimeType: mediaType === "video" ? "video/mp4" : "image/png",
    filePath: `${checksum.slice(0, 2)}/${checksum}.bin`,
    fileSize: 100,
    checksum,
    ...extra,
  });
}

describe("listing", () => {
  it("filters by type, folder, favourite, search and tag", async () => {
    const folder = await library.createFolder("Sunday", null);
    const waves = await asset("Ocean waves.mp4", "video");
    const flyer = await asset("Harvest flyer.png");
    await asset("100%_real.png");
    await library.update(waves.id, { folderId: folder.id, isFavourite: true });
    await library.setTags(flyer.id, ["harvest", "2026"]);

    const names = async (filter: object) =>
      (await library.list({ limit: 50, ...filter })).items
        .map((item) => item.name)
        .sort();

    expect(await names({})).toHaveLength(3);
    expect(await names({ mediaType: "video" })).toEqual(["Ocean waves.mp4"]);
    expect(await names({ folderId: folder.id })).toEqual(["Ocean waves.mp4"]);
    expect(await names({ folderId: null })).toEqual([
      "100%_real.png",
      "Harvest flyer.png",
    ]);
    expect(await names({ favourite: true })).toEqual(["Ocean waves.mp4"]);
    expect(await names({ query: "WAVES" })).toEqual(["Ocean waves.mp4"]);
    expect(await names({ query: "%" })).toEqual(["100%_real.png"]); // escaped
    expect(await names({ tag: "harvest" })).toEqual(["Harvest flyer.png"]);
    expect(
      (await library.list({ limit: 50, tag: "harvest" })).items[0]!.tags,
    ).toEqual(["2026", "harvest"]);
  });

  it("pages with a cursor, newest first", async () => {
    for (let i = 0; i < 5; i += 1) await asset(`a${i}.png`);
    const first = await library.list({ limit: 2 });
    const second = await library.list({ limit: 2, cursor: first.nextCursor! });
    const third = await library.list({ limit: 2, cursor: second.nextCursor! });
    expect([...first.items, ...second.items, ...third.items]).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((i) => i.id)).size,
    ).toBe(4);
  });
});

describe("tags, folders, licences", () => {
  it("setTags dedupes, trims and drops unused tags", async () => {
    const a = await asset("a.png");
    await library.setTags(a.id, [" worship ", "worship", "easter", ""]);
    expect(await library.tags()).toEqual([
      { name: "easter", count: 1 },
      { name: "worship", count: 1 },
    ]);
    await library.setTags(a.id, ["worship"]);
    expect(await library.tags()).toEqual([{ name: "worship", count: 1 }]);
  });

  it("deleting a folder moves its assets to the root", async () => {
    const folder = await library.createFolder("Old", null);
    const a = await asset("a.png");
    await library.update(a.id, { folderId: folder.id });
    expect((await library.folders())[0]).toMatchObject({
      name: "Old",
      assetCount: 1,
    });
    await library.deleteFolder(folder.id);
    expect((await library.get(a.id))?.folderId).toBeNull();
  });

  it("rejects unknown folders", async () => {
    const a = await asset("a.png");
    await expect(
      library.update(a.id, { folderId: newId() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("stores and clears a licence", async () => {
    const a = await asset("a.png");
    await library.setLicence(a.id, {
      licenceType: "creative_commons",
      source: "Unsplash",
      attribution: "Jo",
      terms: null,
    });
    await library.setLicence(a.id, {
      licenceType: "owned",
      source: null,
      attribution: null,
      terms: null,
    });
    expect(await library.licence(a.id)).toEqual({
      licenceType: "owned",
      source: null,
      attribution: null,
      terms: null,
    });
    await library.setLicence(a.id, null);
    expect(await library.licence(a.id)).toBeNull();
  });

  it("marks exactly the missing assets", async () => {
    const a = await asset("a.png");
    const b = await asset("b.png");
    await library.markMissing([a.id]);
    await library.markMissing([b.id]);
    expect((await library.get(a.id))?.isMissing).toBe(false);
    expect(
      (await library.list({ limit: 9, missing: true })).items.map((i) => i.id),
    ).toEqual([b.id]);
  });
});

describe("usage", () => {
  it("reports the church logo, logo screen and presentations", async () => {
    const logo = await asset("logo.png");
    const bg = await asset("bg.mp4", "video");
    const free = await asset("free.png");
    await createWorkspaceRepository(database).setLogo(churchId, logo.id);
    await createSettingsRepository(database, churchId, {
      "live.logoAssetId": {
        default: null as string | null,
        schema: { parse: (v: unknown) => v as string | null },
      },
    }).set("live.logoAssetId", logo.id);
    const now = new Date().toISOString();
    const presentationId = newId();
    await database.db.insert(presentations).values({
      id: presentationId,
      churchId,
      title: "Sunday deck",
      createdAt: now,
      updatedAt: now,
    });
    const slideId = newId();
    await database.db.insert(slides).values({
      id: slideId,
      presentationId,
      position: 0,
      slideType: "text",
      backgroundType: "video",
      backgroundValue: bg.id,
      createdAt: now,
    });
    await database.db.insert(slideObjects).values({
      id: newId(),
      slideId,
      objectType: "image",
      propertiesJson: { assetId: logo.id },
      createdAt: now,
    });

    expect((await library.usage(logo.id)).map((u) => u.type).sort()).toEqual([
      "church-logo",
      "logo-screen",
      "presentation",
    ]);
    expect(await library.usage(bg.id)).toEqual([
      { type: "presentation", id: presentationId, title: "Sunday deck" },
    ]);
    expect(await library.usage(free.id)).toEqual([]);
  });

  it("removing deletes tags links and licence with the asset", async () => {
    const a = await asset("a.png");
    await library.setTags(a.id, ["x"]);
    await library.setLicence(a.id, {
      licenceType: "owned",
      source: null,
      attribution: null,
      terms: null,
    });
    await library.remove(a.id);
    expect(await library.get(a.id)).toBeNull();
    expect(await library.licence(a.id)).toBeNull();
    expect(await library.tags()).toEqual([]);
  });
});
