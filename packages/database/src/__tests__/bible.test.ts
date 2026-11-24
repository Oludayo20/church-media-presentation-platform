import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../client";
import { createBibleRepository } from "../repositories/bible-repository";
import { openMigratedMemoryDb } from "./helpers";

let database: Database;
let bible: ReturnType<typeof createBibleRepository>;

const manifest = {
  code: "TEST",
  name: "Test Bible",
  language: "en",
  licence: "Test",
  attribution: "Fixture",
  versification: "test",
  checksum: "a".repeat(64),
};
const verse = {
  book: "Jòhánù",
  aliases: ["John"],
  chapter: 3,
  verse: 16,
  text: "Ọlọ́run loves the world",
};

beforeEach(async () => {
  database = await openMigratedMemoryDb();
  bible = createBibleRepository(database);
});
afterEach(() => database.close());

it("installs aliases and verse text with translation-scoped full-text search", async () => {
  await bible.install(manifest, [verse]);
  await bible.install({ ...manifest, code: "OTHER" }, [
    { ...verse, text: "Other text" },
  ]);
  expect(await bible.install(manifest, [verse])).toEqual(manifest);
  const books = await bible.books("TEST");
  expect(books).toMatchObject([{ name: "Jòhánù", aliases: ["John"] }]);
  expect(await bible.verses(books[0]!.id)).toMatchObject([
    { chapter: 3, verse: 16, text: verse.text },
  ]);
  expect(bible.search("TEST", "olorun")).toMatchObject([
    { book: "Jòhánù", snippet: "\u0001Ọlọ́run\u0002 loves the world" },
  ]);
  expect(bible.search("OTHER", "olorun")).toEqual([]);
});

it("rolls back both verses and FTS when an import contains a duplicate", async () => {
  await expect(bible.install(manifest, [verse, verse])).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  expect(await bible.translations()).toEqual([]);
  expect(bible.search("TEST", "loves")).toEqual([]);
});

it("saves the same reference once per collection and once in favourites", async () => {
  await bible.install(manifest, [verse]);
  const collection = await bible.createCollection("Sermon");
  for (const id of [null, null, collection.id, collection.id])
    await bible.save("TEST", "John 3:16", id);
  expect(await bible.saved()).toHaveLength(2);
});
