import { open } from "node:fs/promises";
import { MAX_BIBLE_PACKAGE_BYTES, readBiblePackage } from "@cmp/import-export";
import type { BibleJob, JobResult } from "./protocol";

export async function runBible(
  job: BibleJob,
  signal: AbortSignal,
): Promise<JobResult> {
  const file = await open(job.path, "r");
  try {
    const { size } = await file.stat();
    if (size > MAX_BIBLE_PACKAGE_BYTES)
      throw new Error("Bible package is too large");
    const archive = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < archive.length) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(
        archive,
        offset,
        archive.length - offset,
        null,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== size) throw new Error("Bible package changed during import");
    return {
      files: [],
      cancelled: false,
      bible: await readBiblePackage(archive.subarray(0, offset), signal),
    };
  } finally {
    await file.close();
  }
}
