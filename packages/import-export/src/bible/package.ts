// The workspace exports TypeScript source, so downstream tsconfig files need this ambient declaration too.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./unzipper.d.ts" />

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
// Use the local ZIP directory reader without bringing the optional S3 adapters into Electron.
import openDirectory from "unzipper/lib/Open/directory.js";
import {
  bibleImportVerseSchema,
  bibleTranslationSchema,
} from "@cmp/shared-validation";

export const MAX_BIBLE_PACKAGE_BYTES = 32 * 1024 * 1024;
const MAX_VERSE_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;

async function extract(
  entry: Awaited<ReturnType<typeof openDirectory>>["files"][number],
  limit: number,
  signal?: AbortSignal,
) {
  if (entry.uncompressedSize > limit)
    throw new Error(`${entry.path} exceeds its size limit`);
  const chunks: Buffer[] = [];
  let size = 0;
  const stream = entry.stream();
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    signal?.throwIfAborted();
    size += chunk.length;
    if (size > limit) throw new Error(`${entry.path} exceeds its size limit`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

/** Checks the manifest checksum over the original UTF-8 verses.jsonl bytes. */
export async function readBiblePackage(archive: Buffer, signal?: AbortSignal) {
  if (archive.length > MAX_BIBLE_PACKAGE_BYTES)
    throw new Error("Bible package is too large");
  const minEnd = Math.max(0, archive.length - 65_557);
  let end = archive.length - 22;
  for (; end >= minEnd; end--) {
    if (
      archive.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + archive.readUInt16LE(end + 20) === archive.length
    )
      break;
  }
  if (
    end < minEnd ||
    archive.readUInt16LE(end + 4) !== 0 ||
    archive.readUInt16LE(end + 6) !== 0 ||
    archive.readUInt16LE(end + 8) !== 2 ||
    archive.readUInt16LE(end + 10) !== 2
  ) {
    throw new Error("Expected a ZIP with exactly two files");
  }
  const { files } = await openDirectory(
    {
      size: async () => archive.length,
      stream: (offset, length) =>
        Readable.from([
          archive.subarray(offset, length ? offset + length : undefined),
        ]),
    },
    { tailSize: archive.length - end },
  );
  const manifest = files.find(
    (file) => file.path === "manifest.json" && file.type === "File",
  );
  const lines = files.find(
    (file) => file.path === "verses.jsonl" && file.type === "File",
  );
  if (files.length !== 2 || !manifest || !lines)
    throw new Error("Expected manifest.json and verses.jsonl in the package");
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const translation = bibleTranslationSchema.parse(
    JSON.parse(
      utf8.decode(await extract(manifest, MAX_MANIFEST_BYTES, signal)),
    ),
  );
  const bytes = await extract(lines, MAX_VERSE_BYTES, signal);
  if (createHash("sha256").update(bytes).digest("hex") !== translation.checksum)
    throw new Error("Bible package checksum does not match");
  const verses = [];
  const rows = utf8.decode(bytes).trim().split(/\r?\n/u);
  if (rows.length > 100_000)
    throw new Error("Too many verses in Bible package");
  for (const [index, row] of rows.entries()) {
    signal?.throwIfAborted();
    try {
      verses.push(bibleImportVerseSchema.parse(JSON.parse(row)));
    } catch {
      throw new Error(`Invalid verse at line ${index + 1}`);
    }
  }
  if (new Set(verses.map(({ book }) => book)).size > 200)
    throw new Error("Too many books in Bible package");
  return { translation, verses };
}
