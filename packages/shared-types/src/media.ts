export type MediaTypeName = "image" | "video" | "audio" | "document" | "font";

export const LICENCE_TYPE_NAMES = [
  "owned",
  "licensed",
  "public_domain",
  "creative_commons",
  "unknown",
] as const;
export type LicenceTypeName = (typeof LICENCE_TYPE_NAMES)[number];

/** A library asset as the renderer sees it (`media:*`). */
export interface MediaItem {
  id: string;
  name: string;
  mediaType: MediaTypeName;
  category: string | null;
  mimeType: string | null;
  fileSize: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  hasAudio: boolean;
  /** Served at `cmp-media://thumb/<id>`. */
  hasThumbnail: boolean;
  /** Conversion to H.264 MP4 is offered. */
  transcodeReason: "unsupported-codec" | "large-gif" | null;
  /** Plays only with hardware decode support. */
  playbackWarning: "hevc" | null;
  /** Fonts only: the family name to use in text styles. */
  fontFamily: string | null;
  isFavourite: boolean;
  isMissing: boolean;
  folderId: string | null;
  tags: string[];
  createdAt: string;
}

export interface MediaLicenceInfo {
  licenceType: LicenceTypeName;
  source: string | null;
  attribution: string | null;
  terms: string | null;
}

export interface MediaUsageInfo {
  type: "church-logo" | "logo-screen" | "presentation" | "song" | "service";
  id: string;
  title: string;
}

export interface MediaDetail extends MediaItem {
  originalName: string | null;
  licence: MediaLicenceInfo | null;
  usedBy: MediaUsageInfo[];
}

export interface MediaFolderInfo {
  id: string;
  parentId: string | null;
  name: string;
  assetCount: number;
}

/** Pushed as `jobs:progress` while a background job runs. */
export interface JobProgress {
  jobId: string;
  kind: "import" | "transcode";
  status: "running" | "done" | "failed" | "cancelled";
  done: number;
  total: number;
  /** 0–1 across the whole job. */
  fraction: number;
  current: string | null;
  results: {
    name: string;
    outcome: "imported" | "duplicate" | "failed";
    assetId: string | null;
    message: string | null;
  }[];
  error: string | null;
}
