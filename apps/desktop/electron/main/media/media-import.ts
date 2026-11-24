import { basename } from "node:path";
import { AppError } from "@cmp/shared-types";
import type { MediaAsset, MediaRepository } from "@cmp/database";
import {
  ImportError,
  sniffMedia,
  storeFile,
  type MediaKind,
} from "@cmp/media-processing";

export { sniffMedia };

/** Back-compat helper used by the logo tests: images only. */
export function sniffImage(
  bytes: Uint8Array,
): { mime: string; ext: string } | null {
  const type = sniffMedia(bytes);
  return type?.mediaType === "image"
    ? { mime: type.mime, ext: type.ext }
    : null;
}

export interface ImportMediaOptions {
  sourcePath: string;
  mediaDir: string;
  churchId: string;
  category: string;
  media: MediaRepository;
  accept: readonly MediaKind[];
}

/**
 * In-process import for single small files chosen in a dialog (the church
 * logo, the live test deck). Library imports go through the utility worker
 * (MediaLibrary.import), which also probes and makes thumbnails.
 */
export async function importMediaFile(
  options: ImportMediaOptions,
): Promise<MediaAsset> {
  let stored;
  try {
    stored = await storeFile(options.sourcePath, options.mediaDir, {
      accept: options.accept,
    });
  } catch (error) {
    if (error instanceof ImportError) {
      const code =
        error.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : error.code === "IO"
            ? "IO_ERROR"
            : "VALIDATION_ERROR";
      const message =
        error.code === "UNSUPPORTED"
          ? options.accept.includes("video")
            ? "Choose a PNG, JPEG, WebP or GIF image, or an MP4, MOV or WebM video"
            : "Choose a PNG, JPEG, WebP or GIF image"
          : error.code === "NOT_FOUND"
            ? "The selected file could not be read"
            : error.message;
      throw new AppError(code, message);
    }
    throw error;
  }
  const name = basename(options.sourcePath);
  return options.media.createOrGet({
    churchId: options.churchId,
    name,
    originalName: name,
    mediaType: stored.type.mediaType,
    category: options.category,
    mimeType: stored.type.mime,
    filePath: stored.relativePath,
    fileSize: stored.size,
    checksum: stored.checksum,
  });
}

export function importImageFile(
  options: Omit<ImportMediaOptions, "accept">,
): Promise<MediaAsset> {
  return importMediaFile({ ...options, accept: ["image"] });
}
