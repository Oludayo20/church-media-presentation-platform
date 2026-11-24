import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { readBiblePackage } from "../package";

const fixture = new URL("./fixtures/demo.cmpbible", import.meta.url);

it("reads a prepared Bible package with a valid manifest checksum", async () => {
  const { translation, verses } = await readBiblePackage(
    await readFile(fixture),
  );
  expect(translation).toMatchObject({
    code: "DEMO",
    versification: "synthetic",
  });
  expect(verses).toMatchObject([
    {
      book: "John",
      chapter: 3,
      verse: 16,
      text: "A demonstration passage for the test audience.",
    },
    {
      book: "John",
      chapter: 3,
      verse: 17,
      text: "The next line uses milestone markup.",
    },
  ]);
});

it("rejects a truncated package before extracting entries", async () => {
  const archive = await readFile(fixture);
  await expect(
    readBiblePackage(archive.subarray(0, archive.length - 1)),
  ).rejects.toThrow("exactly two files");
});
