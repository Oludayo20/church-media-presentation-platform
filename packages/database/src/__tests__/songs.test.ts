import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client";
import { newId } from "../ids";
import { createMediaLibraryRepository } from "../repositories/media-library-repository";
import { createMediaRepository } from "../repositories/media-repository";
import {
  createSongRepository,
  toFtsQuery,
  type SongInput,
  type SongRepository,
} from "../repositories/song-repository";
import { createWorkspaceRepository } from "../repositories/workspace-repository";
import { openMigratedMemoryDb } from "./helpers";

let database: Database;
let churchId: string;
let repo: SongRepository;

beforeEach(async () => {
  database = await openMigratedMemoryDb();
  churchId = newId();
  await createWorkspaceRepository(database).createWithOwner({
    churchId,
    churchName: "G",
    ownerDisplayName: "O",
  });
  repo = createSongRepository(database, churchId);
});
afterEach(() => database.close());

function song(
  title: string,
  lyrics: string,
  extra: Partial<SongInput> = {},
): SongInput {
  const verse = newId();
  const chorus = newId();
  return {
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
    sections: [
      { id: verse, type: "verse", label: "Verse 1", lyrics },
      { id: chorus, type: "chorus", label: "Chorus", lyrics: "chorus line" },
    ],
    arrangement: [verse, chorus, verse, chorus],
    ...extra,
  };
}

describe("song repository", () => {
  it("round-trips a song with sections and arrangement", async () => {
    const input = song("Morning Song", "line one\nline two", {
      tags: ["joy"],
      artist: "A. Writer",
    });
    const created = await repo.create(input);
    expect(created).toMatchObject({
      title: "Morning Song",
      artist: "A. Writer",
      tags: ["joy"],
      sections: input.sections,
      arrangement: input.arrangement,
    });
  });

  it("update replaces sections and drops arrangement ids that no longer exist", async () => {
    const created = await repo.create(song("A", "x"));
    const keep = created.sections[0]!;
    const updated = await repo.update(created.id, {
      ...created,
      sections: [keep],
      arrangement: [keep.id, created.sections[1]!.id, keep.id],
    });
    expect(updated.sections).toEqual([keep]);
    expect(updated.arrangement).toEqual([keep.id, keep.id]);
  });

  it("rejects duplicate section ids", async () => {
    const input = song("A", "x");
    input.sections[1]!.id = input.sections[0]!.id;
    await expect(repo.create(input)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("delete removes the song and its index entry", async () => {
    const created = await repo.create(song("Gone Song", "unique words here"));
    await repo.delete(created.id);
    expect(await repo.get(created.id)).toBeNull();
    expect(await repo.search({ query: "unique", limit: 10 })).toEqual([]);
  });
});

describe("search", () => {
  beforeEach(async () => {
    await repo.create(song("Grace Abounding", "a quiet morning hymn"));
    await repo.create(song("Morning Has Come", "lyrics about the dawn"));
    await repo.create(
      song("Evening Prayer", "we will sing of grace at morning light"),
    );
    await repo.create(song("Ọlọ́run Ńlá", "Olúwa ṣeun, Ọlọ́run mi"));
    await repo.create(
      song("Chineke", "Ị dị ebube, Onyenwe anyị", { language: "ig" }),
    );
  });

  it("ranks title matches above lyric matches (weighted bm25)", async () => {
    const results = await repo.search({ query: "morning", limit: 10 });
    expect(results[0]!.title).toBe("Morning Has Come");
    expect(results.map((r) => r.title)).toEqual(
      expect.arrayContaining(["Grace Abounding", "Evening Prayer"]),
    );
    const grace = await repo.search({ query: "grace", limit: 10 });
    expect(grace[0]!.title).toBe("Grace Abounding");
  });

  it("matches without diacritics (Yoruba, Igbo)", async () => {
    expect((await repo.search({ query: "olorun", limit: 10 }))[0]!.title).toBe(
      "Ọlọ́run Ńlá",
    );
    expect(
      (await repo.search({ query: "oluwa seun", limit: 10 })).map(
        (r) => r.title,
      ),
    ).toEqual(["Ọlọ́run Ńlá"]);
    expect(
      (await repo.search({ query: "anyi", limit: 10 })).map((r) => r.title),
    ).toEqual(["Chineke"]);
  });

  it("matches prefixes, requires every word, and returns a lyric snippet", async () => {
    const results = await repo.search({ query: "eve pray", limit: 10 });
    expect(results.map((r) => r.title)).toEqual(["Evening Prayer"]);
    const snippet = (await repo.search({ query: "dawn", limit: 10 }))[0]!
      .snippet;
    expect(snippet).toContain("«dawn»");
  });

  it("is safe against FTS syntax in user input", async () => {
    expect(toFtsQuery('grace" OR title:*')).toBe('"grace"* "OR"* "title"*');
    await expect(
      repo.search({ query: 'NEAR(") * ^', limit: 10 }),
    ).resolves.toBeInstanceOf(Array);
    expect(toFtsQuery("  !!! ")).toBeNull();
  });

  it("filters by language and lists alphabetically without a query", async () => {
    expect(
      (await repo.search({ language: "ig", limit: 10 })).map((r) => r.title),
    ).toEqual(["Chineke"]);
    expect((await repo.search({ limit: 3 })).map((r) => r.title)).toEqual([
      "Chineke",
      "Evening Prayer",
      "Grace Abounding",
    ]);
  });
});

describe("collections", () => {
  it("seeds built-ins once and filters songs by collection", async () => {
    await repo.ensureCollections(["Praise", "Worship", "Hymns"]);
    await repo.ensureCollections(["Praise", "Worship", "Hymns"]);
    const collections = await repo.collections();
    expect(collections.map((c) => c.name)).toEqual([
      "Praise",
      "Worship",
      "Hymns",
    ]);
    const hymns = collections[2]!.id;
    await repo.create(
      song("Old Hymn", "x", { collectionIds: [hymns, newId()] }),
    );
    await repo.create(song("New Song", "y"));
    expect(
      (await repo.search({ collectionId: hymns, limit: 10 })).map(
        (s) => s.title,
      ),
    ).toEqual(["Old Hymn"]);
    expect((await repo.collections())[2]!.songCount).toBe(1);
    await expect(repo.createCollection("Hymns")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("media usage", () => {
  it("a song background blocks deleting the asset", async () => {
    const asset = await createMediaRepository(database).createOrGet({
      churchId,
      name: "motion.mp4",
      originalName: "motion.mp4",
      mediaType: "video",
      category: "motion_background",
      mimeType: "video/mp4",
      filePath: "aa/x.mp4",
      fileSize: 1,
      checksum: "f".repeat(64),
    });
    await repo.create(song("Backed", "x", { backgroundAssetId: asset.id }));
    expect(
      await createMediaLibraryRepository(database, churchId).usage(asset.id),
    ).toEqual([
      expect.objectContaining({ type: "song", title: "Song: Backed" }),
    ]);
  });
});
