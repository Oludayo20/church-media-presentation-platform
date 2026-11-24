import { describe, expect, it } from "vitest";
import { matchBibleBook, selectBibleVerses } from "../reference";
import { generateScriptureDocument } from "../slides";

const books = [
  { id: 1, name: "Jòhánù", aliases: ["John"] },
  { id: 2, name: "1 Corinthians", aliases: [] },
  { id: 3, name: "Psalms", aliases: [] },
];
const verses = Array.from({ length: 4 }, (_, chapter) =>
  Array.from({ length: 30 }, (_, verse) => ({
    chapter: chapter + 1,
    verse: verse + 1,
  })),
).flat();
const aliases = ["John", "jn", "Jòhánù", "Johanu", "JOH", "Jhn", "Jn."];
const variants = [":", " ", ".", " : "];

describe("scripture references", () => {
  it.each(
    aliases.flatMap((alias) =>
      variants.flatMap((separator) => [
        { input: `${alias}3${separator}16`, expected: [16] },
        { input: `${alias} 3${separator}16-18`, expected: [16, 17, 18] },
        {
          input: `${alias} 3${separator}16, 3, 5–7`,
          expected: [3, 5, 6, 7, 16],
        },
        { input: `${alias} 3${separator}30—4:2`, expected: [30, 1, 2] },
      ]),
    ),
  )("resolves $input", ({ input, expected }) => {
    const reference = matchBibleBook(input, books);
    expect(reference?.book.id).toBe(1);
    expect(
      selectBibleVerses(reference!.address, verses)?.map(({ verse }) => verse),
    ).toEqual(expected);
  });
  it("resolves a numbered book and a whole chapter", () => {
    expect(matchBibleBook("1 Cor 13:4-7", books)?.book.id).toBe(2);
    expect(
      selectBibleVerses(matchBibleBook("Ps 2", books)!.address, verses),
    ).toHaveLength(30);
  });
  it.each(["0", "5", "3:31", "3:18-16", "3:16-", "3:16,,19", "3:20-4:31"])(
    "rejects %s",
    (address) => {
      expect(selectBibleVerses(address, verses)).toBeNull();
    },
  );
  it("skips omitted intermediate verse numbers but rejects an omitted endpoint", () => {
    const available = verses.filter(
      ({ chapter, verse }) => chapter !== 3 || verse !== 17,
    );
    expect(
      selectBibleVerses("3:16-18", available)?.map(({ verse }) => verse),
    ).toEqual([16, 18]);
    expect(selectBibleVerses("3:16-17", available)).toBeNull();
  });
  it("adds numbered reference footers when a scripture spans multiple slides", () => {
    const passage = generateScriptureDocument(
      "John 3:16–17",
      "TEST",
      ["First", "Second"],
      true,
    );
    expect(
      passage.success && passage.doc.slides.map(({ objects }) => objects[1]),
    ).toMatchObject([
      { content: "John 3:16–17 · TEST (1/2)", role: "footer" },
      { content: "John 3:16–17 · TEST (2/2)", role: "footer" },
    ]);
  });
});
