import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client";
import { newId } from "../ids";
import { createMediaLibraryRepository } from "../repositories/media-library-repository";
import { createMediaRepository } from "../repositories/media-repository";
import { createServiceRepository, type ServiceDraft, type ServiceRepository } from "../repositories/service-repository";
import { createSongRepository, type SongInput } from "../repositories/song-repository";
import { createWorkspaceRepository } from "../repositories/workspace-repository";
import { openMigratedMemoryDb } from "./helpers";

let database: Database;
let churchId: string;
let repo: ServiceRepository;

beforeEach(async () => {
  database = await openMigratedMemoryDb();
  churchId = newId();
  await createWorkspaceRepository(database).createWithOwner({ churchId, churchName: "G", ownerDisplayName: "O" });
  repo = createServiceRepository(database, churchId);
});
afterEach(() => database.close());

const song = (title: string): SongInput => ({
  title,
  artist: null,
  language: "en",
  category: null,
  copyrightOwner: null,
  copyrightYear: null,
  ccliNumber: null,
  licenceReference: null,
  tags: [],
  collectionIds: [],
  backgroundAssetId: null,
  templateId: null,
  split: null,
  sections: [],
  arrangement: [],
});

const item = (itemType: ServiceDraft["items"][number]["itemType"], refId: string | null = null, label: string | null = null) => ({
  id: newId(),
  groupId: null as string | null,
  itemType,
  refId,
  options: { type: itemType },
  label,
  notes: null,
});

const draft = (items: ServiceDraft["items"], groups: ServiceDraft["groups"] = []): ServiceDraft => ({
  title: "Sunday Service",
  serviceType: "sunday",
  serviceDate: "2026-11-29",
  startTime: "09:00",
  theme: null,
  description: null,
  groups,
  items,
});

describe("service repository", () => {
  it("saves items in order and rewrites positions on reorder", async () => {
    const created = await createSongRepository(database, churchId).create(song("Opening"));
    const worship = { id: newId(), name: "Praise & Worship" };
    const items = [item("countdown"), { ...item("song", created.id), groupId: worship.id }, item("blank")];
    const service = await repo.create(draft(items, [worship]));
    expect(service.items.map((i) => i.itemType)).toEqual(["countdown", "song", "blank"]);
    expect(service.items[1]!.groupId).toBe(worship.id);

    const reordered = await repo.save(service.id, { ...service, items: [service.items[2]!, service.items[0]!, service.items[1]!] });
    expect(reordered.items.map((i) => i.itemType)).toEqual(["blank", "countdown", "song"]);
    const positions = database.sqlite.prepare("SELECT position FROM service_items WHERE service_id = ? ORDER BY position").all(service.id);
    expect(positions.map((p) => p["position"])).toEqual([0, 1, 2]);
  });

  it("checks references on write but allows template placeholders", async () => {
    await expect(repo.create(draft([item("song", newId())]))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(repo.create(draft([item("countdown", newId())]))).rejects.toThrow(/take no reference/);
    const placeholder = await repo.create(draft([item("song", null, "Opening song")]));
    expect(placeholder.items[0]).toMatchObject({ refId: null, label: "Opening song" });
  });

  it("checks media items point at the right kind of media", async () => {
    const asset = await createMediaRepository(database).createOrGet({
      churchId,
      name: "flyer.png",
      originalName: "flyer.png",
      mediaType: "image",
      category: "flyer",
      mimeType: "image/png",
      filePath: "aa/x.png",
      fileSize: 1,
      checksum: "a".repeat(64),
    });
    await expect(repo.create(draft([item("video", asset.id)]))).rejects.toThrow(/not a video/);
    expect((await repo.create(draft([item("image", asset.id)]))).items).toHaveLength(1);
    expect((await createMediaLibraryRepository(database, churchId).usage(asset.id)).map((u) => u.type)).toEqual(["service"]);
  });

  it("duplicates with the same refs, new ids and a new date", async () => {
    const group = { id: newId(), name: "Word" };
    const source = await repo.create(draft([{ ...item("blank"), groupId: group.id }], [group]));
    const copy = await repo.duplicate(source.id, "2026-12-06");
    expect(copy.id).not.toBe(source.id);
    expect(copy.serviceDate).toBe("2026-12-06");
    expect(copy.items[0]!.id).not.toBe(source.items[0]!.id);
    expect(copy.items[0]!.groupId).toBe(copy.groups[0]!.id);
    expect(copy.groups[0]!.id).not.toBe(group.id);
  });

  it("blocks deleting a song a service uses, then allows it once removed", async () => {
    const songs = createSongRepository(database, churchId);
    const used = await songs.create(song("Used"));
    const service = await repo.create(draft([item("song", used.id)]));
    expect(await repo.usage(used.id)).toEqual([{ id: service.id, title: "Sunday Service", serviceDate: "2026-11-29" }]);
    await expect(songs.delete(used.id)).rejects.toMatchObject({ code: "CONFLICT", message: /Used in 1 service/ });
    await repo.save(service.id, { ...service, items: [] });
    await songs.delete(used.id);
  });

  it("lists newest first and deletes with children", async () => {
    await repo.create({ ...draft([]), title: "Old", serviceDate: "2026-01-04" });
    const recent = await repo.create(draft([item("blank")]));
    expect((await repo.list()).map((s) => s.title)).toEqual(["Sunday Service", "Old"]);
    expect((await repo.list())[0]!.itemCount).toBe(1);
    await repo.delete(recent.id);
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM service_items").get()!["n"]).toBe(0);
  });

  it("song favourites", async () => {
    const songs = createSongRepository(database, churchId);
    const a = await songs.create(song("Amazing"));
    await songs.create(song("Bless"));
    await songs.setFavourite(a.id, true);
    expect(await songs.favourites(5)).toEqual([{ id: a.id, title: "Amazing", artist: null }]);
  });
});
