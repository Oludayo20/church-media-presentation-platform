import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { openZipFile, parsePptx } from "@cmp/import-export";
import { processFile, type Progress } from "./jobs";
import type { ImportedFile, JobResult, PptxJob } from "./protocol";

const PPTX_ZIP_LIMITS = {
  maxEntries: 20_000,
  maxTotalBytes: 4 * 1024 * 1024 * 1024,
};
const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * PowerPoint import (docs/TASKS.md Phase 7) in the worker: parse the deck,
 * then stream every referenced picture/video out of the zip into the
 * content-addressed media store (probe + thumbnail like any import).
 * Main persists the assets and builds the presentation.
 */
export async function runPptx(
  job: PptxJob,
  signal: AbortSignal,
  progress: Progress,
): Promise<JobResult> {
  progress({ done: 0, total: 1, fraction: 0.02, current: basename(job.path) });
  const zip = await openZipFile(job.path, PPTX_ZIP_LIMITS);
  const deck = await parsePptx(zip, { fileName: basename(job.path), signal });

  const files: ImportedFile[] = [];
  const mediaFiles: Record<string, number> = {};
  for (const [index, zipPath] of deck.media.entries()) {
    signal.throwIfAborted();
    const name = basename(zipPath);
    progress({
      done: index,
      total: deck.media.length,
      fraction: 0.1 + (0.9 * index) / Math.max(1, deck.media.length),
      current: name,
    });
    const temp = join(
      job.mediaDir,
      `.pptx-${randomUUID()}${extname(zipPath).toLowerCase()}`,
    );
    try {
      await zip.extractTo(zipPath, temp, MAX_MEDIA_BYTES, signal);
      const file = await processFile(temp, name, job, signal);
      mediaFiles[zipPath] = files.push({ ...file, path: zipPath, name }) - 1;
    } catch (error) {
      if (signal.aborted) throw error;
      mediaFiles[zipPath] =
        files.push({
          ok: false,
          path: zipPath,
          name,
          message: "This media file could not be imported",
        }) - 1;
    } finally {
      await rm(temp, { force: true });
    }
  }
  progress({
    done: deck.media.length,
    total: deck.media.length,
    fraction: 1,
    current: null,
  });
  return { files, pptx: { deck, mediaFiles }, cancelled: false };
}
