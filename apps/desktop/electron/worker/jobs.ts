import { readFile, rm, stat } from "node:fs/promises";
import { parseSongFile, SongImportError } from "@cmp/import-export";
import { basename, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import {
  fontFamilyName,
  ImportError,
  makeThumbnail,
  playbackAdvice,
  probe,
  storeFile,
  transcodeToMp4,
  type FfTools,
  type ProbeResult,
} from "@cmp/media-processing";
import type {
  ImportedFile,
  ImportJob,
  JobResult,
  SongFileResult,
  SongsJob,
  TranscodeJob,
} from "./protocol";

export type Progress = (update: {
  done: number;
  total: number;
  fraction: number;
  current: string | null;
}) => void;

/**
 * DOCUMENTATION.md §7 steps 2–6 for each file: validate, hash + atomic copy,
 * probe, thumbnail/poster, playback advice. One failure never stops the
 * batch; cancelling stops after the current file and keeps what finished.
 */
export async function runImport(
  job: ImportJob,
  signal: AbortSignal,
  progress: Progress,
): Promise<JobResult> {
  const files: ImportedFile[] = [];
  const total = job.files.length;
  for (const [index, path] of job.files.entries()) {
    if (signal.aborted) return { files, cancelled: true };
    const name = basename(path);
    progress({ done: index, total, fraction: index / total, current: name });
    try {
      files.push(
        await processFile(path, name, job, signal, (copied) =>
          progress({
            done: index,
            total,
            fraction: (index + copied * 0.8) / total,
            current: name,
          }),
        ),
      );
    } catch (error) {
      if (signal.aborted) return { files, cancelled: true };
      files.push({ ok: false, path, name, message: describe(error) });
    }
  }
  progress({ done: total, total, fraction: 1, current: null });
  return { files, cancelled: false };
}

/** Converts to H.264 MP4, then stores the result like a fresh import. */
export async function runTranscode(
  job: TranscodeJob,
  signal: AbortSignal,
  progress: Progress,
): Promise<JobResult> {
  if (!job.tools.ffmpeg)
    throw new Error("ffmpeg is not available on this computer");
  const name = job.name.replace(/\.[^.]+$/, "") + ".mp4";
  const temp = join(job.mediaDir, `.transcode-${randomUUID()}.mp4`);
  try {
    await transcodeToMp4({
      ffmpeg: job.tools.ffmpeg,
      source: job.source,
      target: temp,
      durationMs: job.durationMs,
      signal,
      onProgress: (fraction) =>
        progress({
          done: 0,
          total: 1,
          fraction: fraction * 0.9,
          current: name,
        }),
    });
    const file = await processFile(temp, name, job, signal);
    progress({ done: 1, total: 1, fraction: 1, current: null });
    return { files: [file], cancelled: false };
  } catch (error) {
    if (signal.aborted) return { files: [], cancelled: true };
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}

export async function processFile(
  path: string,
  name: string,
  job: { mediaDir: string; thumbsDir: string; tools: FfTools },
  signal: AbortSignal,
  onCopy?: (fraction: number) => void,
): Promise<ImportedFile> {
  const stored = await storeFile(path, job.mediaDir, {
    signal,
    onProgress: (bytes, size) => onCopy?.(size ? bytes / size : 1),
  });
  const absolute = join(job.mediaDir, stored.relativePath);
  const visual =
    stored.type.mediaType === "image" || stored.type.mediaType === "video";
  const timed =
    stored.type.mediaType === "video" || stored.type.mediaType === "audio";

  let probed: ProbeResult | null = null;
  if (job.tools.ffprobe && (timed || visual)) {
    probed = await probe(job.tools.ffprobe, absolute, signal).catch(() => null);
  }
  let thumbnail: string | null = null;
  if (job.tools.ffmpeg && visual) {
    thumbnail = await makeThumbnail({
      ffmpeg: job.tools.ffmpeg,
      source: absolute,
      targetBase: join(job.thumbsDir, stored.checksum),
      isVideo: stored.type.mediaType === "video",
      durationMs: probed?.durationMs ?? null,
      signal,
    })
      .then((file) => relative(job.thumbsDir, file))
      .catch(() => null);
  }
  const fontFamily =
    stored.type.mediaType === "font"
      ? fontFamilyName(await readFile(absolute))
      : null;
  return {
    ok: true,
    path,
    name,
    stored,
    fontFamily,
    probe: probed,
    thumbnail,
    advice: playbackAdvice({
      mime: stored.type.mime,
      size: stored.size,
      probe: probed,
    }),
  };
}

function describe(error: unknown): string {
  if (error instanceof ImportError) return error.message;
  return "This file could not be imported";
}

const MAX_SONG_FILE_BYTES = 1024 * 1024;

/** Song files are parsed here, not in main (SECURITY.md: parsers in the worker). */
export async function runSongs(
  job: SongsJob,
  signal: AbortSignal,
  progress: Progress,
): Promise<JobResult> {
  const songs: SongFileResult[] = [];
  const total = job.files.length;
  for (const [index, path] of job.files.entries()) {
    if (signal.aborted) return { files: [], songs, cancelled: true };
    const name = basename(path);
    progress({ done: index, total, fraction: index / total, current: name });
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new SongImportError("Not a file");
      if (info.size > MAX_SONG_FILE_BYTES)
        throw new SongImportError("This file is too large to be a song");
      const text = new TextDecoder("utf-8", { fatal: false }).decode(
        await readFile(path),
      );
      songs.push({ ok: true, path, name, song: parseSongFile(name, text) });
    } catch (error) {
      songs.push({
        ok: false,
        path,
        name,
        message:
          error instanceof SongImportError
            ? error.message
            : "This file could not be read",
      });
    }
  }
  progress({ done: total, total, fraction: 1, current: null });
  return { files: [], songs, cancelled: false };
}
