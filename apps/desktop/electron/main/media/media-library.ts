import { stat, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { AppError } from "@cmp/shared-types";
import type { JobProgress, MediaDetail, MediaItem } from "@cmp/shared-types";
import type { LibraryAsset, MediaLicence } from "@cmp/database";
import type { FfTools } from "@cmp/media-processing";
import type { Logger } from "../logging/logger";
import type { JobRunner } from "../jobs/job-runner";
import type {
  OpenWorkspace,
  WorkspaceManager,
} from "../workspace/workspace-manager";
import type { ImportedFile, JobResult } from "../../worker/protocol";

export interface MediaLibraryOptions {
  workspaces: WorkspaceManager;
  jobs: JobRunner;
  tools: () => FfTools;
  logger: Logger;
  pushProgress(progress: JobProgress): void;
  pushChanged(reason: string): void;
  chooseFiles(): Promise<string[]>;
}

export interface ImportRequest {
  paths: string[];
  folderId?: string | null | undefined;
  tags?: string[] | undefined;
  licence?: MediaLicence | null | undefined;
}

const DEFAULT_CATEGORY: Record<MediaItem["mediaType"], string> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
  font: "font",
};

/**
 * The media library service (DOCUMENTATION.md §7): starts worker jobs,
 * persists their results (dedupe on checksum → "Already in library"), and
 * owns delete-with-usage, missing-file scans and transcode offers.
 */
export function createMediaLibrary(options: MediaLibraryOptions) {
  const { workspaces, jobs, logger } = options;

  function progressFor(
    jobId: string,
    kind: JobProgress["kind"],
    total: number,
  ): JobProgress {
    return {
      jobId,
      kind,
      status: "running",
      done: 0,
      total,
      fraction: 0,
      current: null,
      results: [],
      error: null,
    };
  }

  /** Persists one finished file; returns its outcome. */
  async function persist(
    workspace: OpenWorkspace,
    file: ImportedFile,
    request: Omit<ImportRequest, "paths">,
    nameOverride?: string,
  ): Promise<JobProgress["results"][number]> {
    if (!file.ok)
      return {
        name: file.name,
        outcome: "failed",
        assetId: null,
        message: file.message,
      };
    const existing = await workspace.media.findByChecksum(
      workspace.id,
      file.stored.checksum,
    );
    if (existing) {
      return {
        name: file.name,
        outcome: "duplicate",
        assetId: existing.id,
        message: "Already in library",
      };
    }
    const { stored, probe, advice } = file;
    const asset = await workspace.media.createOrGet({
      churchId: workspace.id,
      name: nameOverride ?? file.name,
      originalName: file.name,
      mediaType: stored.type.mediaType,
      category: DEFAULT_CATEGORY[stored.type.mediaType],
      mimeType: stored.type.mime,
      filePath: stored.relativePath,
      fileSize: stored.size,
      checksum: stored.checksum,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      durationMs:
        stored.type.mediaType === "image" ? null : (probe?.durationMs ?? null),
      codec: probe?.videoCodec ?? probe?.audioCodec ?? null,
      hasAudio: probe?.hasAudio ?? false,
      thumbnailPath: file.thumbnail,
      transcodeReason: advice.transcodeReason,
      playbackWarning: advice.playbackWarning,
      fontFamily: file.fontFamily ?? null,
      folderId: request.folderId ?? null,
    });
    if (request.tags?.length)
      await workspace.library.setTags(asset.id, request.tags);
    if (request.licence)
      await workspace.library.setLicence(asset.id, request.licence);
    return {
      name: file.name,
      outcome: "imported",
      assetId: asset.id,
      message: null,
    };
  }

  function track(
    kind: JobProgress["kind"],
    total: number,
    start: (onProgress: Parameters<JobRunner["start"]>[1]) => {
      jobId: string;
      done: Promise<JobResult>;
    },
    finish: (
      workspace: OpenWorkspace,
      result: JobResult,
    ) => Promise<JobProgress["results"]>,
  ): string {
    const workspace = workspaces.require();
    let progress: JobProgress;
    const { jobId, done } = start((update) => {
      progress = { ...progress, ...update, status: "running" };
      options.pushProgress(progress);
    });
    progress = progressFor(jobId, kind, total);
    options.pushProgress(progress);

    done
      .then(async (result) => {
        const results = await finish(workspace, result);
        progress = {
          ...progress,
          status: result.cancelled ? "cancelled" : "done",
          done: results.length,
          fraction: 1,
          current: null,
          results,
        };
        options.pushProgress(progress);
        options.pushChanged(kind);
      })
      .catch((error: unknown) => {
        logger.error(`[media] ${kind} job failed`, error);
        progress = {
          ...progress,
          status: "failed",
          current: null,
          error: error instanceof Error ? error.message : String(error),
        };
        options.pushProgress(progress);
      });
    return jobId;
  }

  async function detail(
    workspace: OpenWorkspace,
    asset: LibraryAsset,
  ): Promise<MediaDetail> {
    return {
      ...toItem(asset),
      originalName: asset.originalName,
      licence: await workspace.library.licence(asset.id),
      usedBy: await workspace.library.usage(asset.id),
    };
  }

  async function requireAsset(
    workspace: OpenWorkspace,
    id: string,
  ): Promise<LibraryAsset> {
    const asset = await workspace.library.get(id);
    if (!asset) throw new AppError("NOT_FOUND", "Media not found");
    return asset;
  }

  return {
    toItem,

    /**
     * Persists files a worker job already stored (PPTX/PDF media): dedupe on
     * checksum, metadata, tags. Returns each file's outcome and asset id.
     */
    async persistAll(
      files: ImportedFile[],
      request: Omit<ImportRequest, "paths"> = {},
    ): Promise<JobProgress["results"]> {
      const workspace = workspaces.require();
      const outcomes: JobProgress["results"] = [];
      for (const file of files)
        outcomes.push(await persist(workspace, file, request));
      if (outcomes.some((outcome) => outcome.outcome === "imported"))
        options.pushChanged("import");
      return outcomes;
    },

    async get(id: string): Promise<MediaDetail> {
      const workspace = workspaces.require();
      return detail(workspace, await requireAsset(workspace, id));
    },

    /** Starts an import job and returns its id immediately. */
    import(request: ImportRequest): string {
      const workspace = workspaces.require();
      const paths = [...new Set(request.paths)];
      if (paths.some((path) => !isAbsolute(path))) {
        throw new AppError("VALIDATION_ERROR", "Import paths must be absolute");
      }
      return track(
        "import",
        paths.length,
        (onProgress) =>
          jobs.start(
            {
              kind: "import",
              files: paths,
              mediaDir: workspace.mediaDir,
              thumbsDir: workspace.thumbsDir,
              tools: options.tools(),
            },
            onProgress,
          ),
        async (target, result) => {
          const outcomes: JobProgress["results"] = [];
          for (const file of result.files)
            outcomes.push(await persist(target, file, request));
          logger.info(
            `[media] import: ${outcomes.filter((o) => o.outcome === "imported").length} imported, ${outcomes.filter((o) => o.outcome === "duplicate").length} duplicate, ${outcomes.filter((o) => o.outcome === "failed").length} failed`,
          );
          return outcomes;
        },
      );
    },

    async chooseAndImport(
      folderId: string | null | undefined,
    ): Promise<string | null> {
      workspaces.require();
      const paths = await options.chooseFiles();
      return paths.length > 0 ? this.import({ paths, folderId }) : null;
    },

    cancel(jobId: string): boolean {
      return jobs.cancel(jobId);
    },

    /** Converts an asset to H.264 MP4 as a new asset beside the original. */
    async transcode(id: string): Promise<string> {
      const workspace = workspaces.require();
      const asset = await requireAsset(workspace, id);
      if (!options.tools().ffmpeg) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Converting needs ffmpeg, which is not available on this computer",
        );
      }
      return track(
        "transcode",
        1,
        (onProgress) =>
          jobs.start(
            {
              kind: "transcode",
              source: join(workspace.mediaDir, asset.filePath),
              name: asset.name,
              durationMs: asset.durationMs,
              mediaDir: workspace.mediaDir,
              thumbsDir: workspace.thumbsDir,
              tools: options.tools(),
            },
            onProgress,
          ),
        async (target, result) => {
          const outcomes: JobProgress["results"] = [];
          for (const file of result.files) {
            outcomes.push(
              await persist(
                target,
                file,
                { folderId: asset.folderId, tags: asset.tags },
                `${asset.name.replace(/\.[^.]+$/, "")} (MP4)`,
              ),
            );
          }
          return outcomes;
        },
      );
    },

    /** Deletes the asset and its files — unless something still uses it. */
    async delete(id: string): Promise<void> {
      const workspace = workspaces.require();
      const usedBy = await workspace.library.usage(id);
      if (usedBy.length > 0) {
        throw new AppError("CONFLICT", "This media is still in use", {
          usedBy,
        });
      }
      const removed = await workspace.library.remove(id);
      await rm(join(workspace.mediaDir, removed.filePath), { force: true });
      if (removed.thumbnailPath)
        await rm(join(workspace.thumbsDir, removed.thumbnailPath), {
          force: true,
        });
      options.pushChanged("delete");
    },

    /** §7 step 8: every file exists with the recorded size. */
    async scanMissing(): Promise<string[]> {
      const workspace = workspaces.current();
      if (!workspace) return [];
      const assets = await workspace.library.all();
      const missing: string[] = [];
      for (const asset of assets) {
        const info = await stat(join(workspace.mediaDir, asset.filePath)).catch(
          () => null,
        );
        if (!info?.isFile() || info.size !== asset.fileSize)
          missing.push(asset.id);
      }
      const changed = assets.some(
        (asset) => asset.isMissing !== missing.includes(asset.id),
      );
      await workspace.library.markMissing(missing);
      if (missing.length > 0)
        logger.warn(`[media] ${missing.length} asset(s) missing on disk`);
      if (changed) options.pushChanged("scan");
      return missing;
    },
  };
}

export function toItem(asset: LibraryAsset): MediaItem {
  return {
    id: asset.id,
    name: asset.name,
    mediaType: asset.mediaType,
    category: asset.category,
    mimeType: asset.mimeType,
    fileSize: asset.fileSize,
    durationMs: asset.durationMs,
    width: asset.width,
    height: asset.height,
    codec: asset.codec,
    hasAudio: asset.hasAudio,
    hasThumbnail: asset.thumbnailPath !== null,
    transcodeReason:
      asset.transcodeReason === "unsupported-codec" ||
      asset.transcodeReason === "large-gif"
        ? asset.transcodeReason
        : null,
    playbackWarning: asset.playbackWarning === "hevc" ? "hevc" : null,
    fontFamily: asset.fontFamily,
    isFavourite: asset.isFavourite,
    isMissing: asset.isMissing,
    folderId: asset.folderId,
    tags: asset.tags,
    createdAt: asset.createdAt,
  };
}

export type MediaLibrary = ReturnType<typeof createMediaLibrary>;
