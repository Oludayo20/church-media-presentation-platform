/**
 * Main ↔ worker messages (`utilityProcess`, ARCHITECTURE.md §5). The worker
 * never touches the database: it does the file and ffmpeg work and returns
 * results that main persists.
 */
import type {
  ParsedSong,
  readBiblePackage,
  PptxDeck,
} from "@cmp/import-export";
import type {
  FfTools,
  ProbeResult,
  StoredFile,
  playbackAdvice,
} from "@cmp/media-processing";

export interface ImportJob {
  kind: "import";
  files: string[];
  mediaDir: string;
  thumbsDir: string;
  tools: FfTools;
}

export interface TranscodeJob {
  kind: "transcode";
  /** Absolute path of the stored source file. */
  source: string;
  name: string;
  durationMs: number | null;
  mediaDir: string;
  thumbsDir: string;
  tools: FfTools;
}

/** Parses song files (plain text, OpenLyrics, CCLI SongSelect). */
export interface SongsJob {
  kind: "songs";
  files: string[];
}

export interface BibleJob {
  kind: "bible";
  path: string;
}

/** Imports a PowerPoint file: parse in the worker, store its media. */
export interface PptxJob {
  kind: "pptx";
  path: string;
  mediaDir: string;
  thumbsDir: string;
  tools: FfTools;
}

export type Job = ImportJob | TranscodeJob | SongsJob | BibleJob | PptxJob;

export type SongFileResult =
  | { ok: true; path: string; name: string; song: ParsedSong }
  | { ok: false; path: string; name: string; message: string };

export type ImportedFile =
  | {
      ok: true;
      path: string;
      name: string;
      stored: StoredFile;
      probe: ProbeResult | null;
      /** Relative to `thumbsDir`. */
      thumbnail: string | null;
      advice: ReturnType<typeof playbackAdvice>;
      /** Fonts: family name from the `name` table. */
      fontFamily: string | null;
    }
  | { ok: false; path: string; name: string; message: string };

export interface JobResult {
  files: ImportedFile[];
  /** Song-file jobs only. */
  songs?: SongFileResult[];
  bible?: Awaited<ReturnType<typeof readBiblePackage>>;
  /** PPTX jobs: the parsed deck, and which `files` entry holds each media zip path. */
  pptx?: { deck: PptxDeck; mediaFiles: Record<string, number> };
  cancelled: boolean;
}

export type ToWorker =
  | { type: "start"; jobId: string; job: Job }
  | { type: "cancel"; jobId: string };

export type FromWorker =
  | {
      type: "progress";
      jobId: string;
      done: number;
      total: number;
      fraction: number;
      current: string | null;
    }
  | { type: "result"; jobId: string; result: JobResult }
  | { type: "error"; jobId: string; message: string };
