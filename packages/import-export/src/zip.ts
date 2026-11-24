// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./bible/unzipper.d.ts" />
import { createReadStream, createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import openDirectory from "unzipper/lib/Open/directory.js";

export interface ZipLimits {
  /** Max entries in the central directory (zip bombs with millions of files). */
  maxEntries: number;
  /** Max uncompressed bytes read from the whole archive. */
  maxTotalBytes: number;
}

export interface ZipArchive {
  paths(): string[];
  has(path: string): boolean;
  size(path: string): number;
  /** Reads an entry into memory, refusing more than `limit` bytes. */
  read(path: string, limit: number, signal?: AbortSignal): Promise<Buffer>;
  /** Streams an entry to a file, refusing more than `limit` bytes. */
  extractTo(
    path: string,
    destination: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<number>;
}

/**
 * Random-access ZIP reader over a file on disk (PPTX can be hundreds of MB
 * with video). Every read is bounded per entry and in total, whatever the
 * central directory claims, so a decompression bomb stops at the limit
 * (SECURITY.md "zip-slip/bomb limits"). Entries are only ever read into
 * memory or into a caller-chosen file — paths inside the zip are never used
 * as file-system paths, so zip-slip cannot happen.
 */
export async function openZipFile(
  path: string,
  limits: ZipLimits,
): Promise<ZipArchive> {
  const handle = await open(path, "r");
  let size: number;
  let tailSize: number;
  try {
    size = (await handle.stat()).size;
    const tailLength = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    let end = tail.length - 22;
    for (; end >= 0; end--) {
      if (
        tail.readUInt32LE(end) === 0x06054b50 &&
        end + 22 + tail.readUInt16LE(end + 20) === tail.length
      )
        break;
    }
    if (end < 0) throw new Error("Not a ZIP file");
    if (tail.readUInt16LE(end + 10) > limits.maxEntries)
      throw new Error("The file contains too many parts");
    tailSize = tail.length - end;
  } finally {
    await handle.close();
  }

  const { files } = await openDirectory(
    {
      size: async () => size,
      stream: (offset, length) =>
        createReadStream(path, {
          start: offset,
          ...(length ? { end: offset + length - 1 } : {}),
        }),
    },
    { tailSize },
  );
  if (files.length > limits.maxEntries)
    throw new Error("The file contains too many parts");
  const entries = new Map(
    files
      .filter((file) => file.type === "File")
      .map((file) => [file.path, file]),
  );
  let total = 0;

  const counter = (entryPath: string, limit: number, signal?: AbortSignal) => {
    let size = 0;
    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        total += chunk.length;
        if (signal?.aborted) return callback(new Error("cancelled"));
        if (size > limit)
          return callback(new Error(`${entryPath} is larger than allowed`));
        if (total > limits.maxTotalBytes)
          return callback(
            new Error("The file expands to more than is allowed"),
          );
        callback(null, chunk);
      },
    });
  };

  const entry = (entryPath: string) => {
    const found = entries.get(entryPath);
    if (!found) throw new Error(`${entryPath} is missing`);
    return found;
  };

  return {
    paths: () => [...entries.keys()],
    has: (entryPath) => entries.has(entryPath),
    size: (entryPath) => entries.get(entryPath)?.uncompressedSize ?? 0,
    async read(entryPath, limit, signal) {
      const found = entry(entryPath);
      if (found.uncompressedSize > limit)
        throw new Error(`${entryPath} is larger than allowed`);
      const chunks: Buffer[] = [];
      await pipeline(
        found.stream(),
        counter(entryPath, limit, signal),
        async (source: AsyncIterable<Buffer>) => {
          for await (const chunk of source) chunks.push(chunk);
        },
      );
      return Buffer.concat(chunks);
    },
    async extractTo(entryPath, destination, limit, signal) {
      const found = entry(entryPath);
      if (found.uncompressedSize > limit)
        throw new Error(`${entryPath} is larger than allowed`);
      let written = 0;
      const count = counter(entryPath, limit, signal);
      count.on("data", (chunk: Buffer) => {
        written += chunk.length;
      });
      await pipeline(
        found.stream(),
        count,
        createWriteStream(destination, { flags: "wx" }),
      );
      return written;
    },
  };
}
