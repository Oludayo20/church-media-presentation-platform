import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SNIFF_BYTES, sniffMedia, type SniffedType } from "./sniff";

export class ImportError extends Error {
  constructor(
    readonly code:
      "UNSUPPORTED" | "TOO_LARGE" | "NOT_FOUND" | "IO" | "CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/** Per-type size limits. */
export const SIZE_LIMITS: Record<SniffedType["mediaType"], number> = {
  image: 50 * 1024 * 1024,
  video: 8 * 1024 * 1024 * 1024,
  audio: 1024 * 1024 * 1024,
  document: 500 * 1024 * 1024,
  font: 50 * 1024 * 1024,
};

export interface StoredFile {
  type: SniffedType;
  checksum: string;
  size: number;
  /** `<aa>/<sha256>.<ext>`, relative to the media directory. */
  relativePath: string;
  /** The content was already in the store; nothing was copied. */
  alreadyStored: boolean;
}

export interface StoreOptions {
  signal?: AbortSignal;
  /** Bytes copied so far. */
  onProgress?: (bytes: number, total: number) => void;
  accept?: readonly SniffedType["mediaType"][];
}

export async function readHead(
  path: string,
  length = SNIFF_BYTES,
): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * DOCUMENTATION.md §7 steps 2–4: validate, then stream the file once,
 * hashing as it is copied to a temp file in the media directory; fsync;
 * rename to the content-addressed path. An interrupted or cancelled copy
 * leaves no partial file under any final name. If identical content is
 * already stored, the temp copy is dropped.
 */
export async function storeFile(
  sourcePath: string,
  mediaDir: string,
  options: StoreOptions = {},
): Promise<StoredFile> {
  const info = await stat(sourcePath).catch(() => null);
  if (!info?.isFile())
    throw new ImportError("NOT_FOUND", "The file could not be read");

  const fileName = sourcePath.split(/[\\/]/).pop() ?? "";
  const type = sniffMedia(await readHead(sourcePath), fileName);
  if (!type || (options.accept && !options.accept.includes(type.mediaType))) {
    throw new ImportError("UNSUPPORTED", "This file type is not supported");
  }
  if (info.size > SIZE_LIMITS[type.mediaType]) {
    throw new ImportError("TOO_LARGE", `This ${type.mediaType} is too large`);
  }

  await mkdir(mediaDir, { recursive: true });
  const temp = join(mediaDir, `.import-${randomUUID()}.tmp`);
  let checksum: string;
  try {
    checksum = await copyWithHash(sourcePath, temp, info.size, options);
  } catch (error) {
    await rm(temp, { force: true });
    if (error instanceof ImportError) throw error;
    throw new ImportError("IO", `Could not copy the file: ${String(error)}`);
  }

  const relativePath = `${checksum.slice(0, 2)}/${checksum}.${type.ext}`;
  const destination = join(mediaDir, relativePath);
  const alreadyStored = existsSync(destination);
  if (alreadyStored) {
    await rm(temp, { force: true });
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await rename(temp, destination);
  }
  return { type, checksum, size: info.size, relativePath, alreadyStored };
}

async function copyWithHash(
  source: string,
  target: string,
  total: number,
  options: StoreOptions,
): Promise<string> {
  const hash = createHash("sha256");
  const output = await open(target, "wx");
  let copied = 0;
  let lastReport = 0;
  try {
    for await (const chunk of createReadStream(source, {
      highWaterMark: 1024 * 1024,
    })) {
      if (options.signal?.aborted)
        throw new ImportError("CANCELLED", "Import cancelled");
      const buffer = chunk as Buffer;
      hash.update(buffer);
      await output.write(buffer);
      copied += buffer.byteLength;
      if (copied - lastReport >= 8 * 1024 * 1024 || copied === total) {
        lastReport = copied;
        options.onProgress?.(copied, total);
      }
    }
    await output.sync();
  } finally {
    await output.close();
  }
  return hash.digest("hex");
}
