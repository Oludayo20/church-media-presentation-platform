import { isAbsolute } from "node:path";
import {
  DEFAULT_SONG_BACKGROUND,
  generateSongDocument,
  parseLyrics,
  SONG_TEMPLATES,
  type ParsedSong,
} from "@cmp/import-export";
import { newId, type SongRecord } from "@cmp/database";
import { AppError } from "@cmp/shared-types";
import type {
  LiveState,
  SongData,
  SongDetail,
  SongListItem,
} from "@cmp/shared-types";
import {
  DEFAULT_SONG_COLLECTIONS,
  engineDocumentSchema,
  type Background,
  type EngineDocument,
} from "@cmp/shared-validation";
import type { JobRunner } from "../jobs/job-runner";
import type { LiveSessionController } from "../live/live-session";
import type { Logger } from "../logging/logger";
import type {
  OpenWorkspace,
  WorkspaceManager,
} from "../workspace/workspace-manager";

export interface SongServiceOptions {
  workspaces: WorkspaceManager;
  jobs: JobRunner;
  live: () => LiveSessionController;
  logger: Logger;
  chooseFiles(): Promise<string[]>;
}

/**
 * Songs (DOCUMENTATION.md §5): CRUD, lyrics-to-slides generation (the same
 * code path for the editor preview and the projector), importing song files
 * through the worker, and live lyric edits (§3.6).
 */
export function createSongService(options: SongServiceOptions) {
  const { workspaces, logger } = options;
  const seeded = new Set<string>();

  async function repo(): Promise<OpenWorkspace["songs"]> {
    const workspace = workspaces.require();
    if (!seeded.has(workspace.id)) {
      await workspace.songs.ensureCollections(DEFAULT_SONG_COLLECTIONS);
      seeded.add(workspace.id);
    }
    return workspace.songs;
  }

  async function background(
    workspace: OpenWorkspace,
    assetId: string | null,
  ): Promise<Background> {
    if (!assetId) return DEFAULT_SONG_BACKGROUND;
    const asset = await workspace.media.findById(assetId);
    if (!asset || asset.isMissing) return DEFAULT_SONG_BACKGROUND;
    const src = `cmp-media://asset/${asset.id}`;
    if (asset.mediaType === "video")
      return { type: "video", src, loop: true, muted: true, fit: "cover" };
    if (asset.mediaType === "image")
      return { type: "image", src, fit: "cover" };
    return DEFAULT_SONG_BACKGROUND;
  }

  /** §5.2 for a saved song or an unsaved draft. */
  async function generate(
    songId: string,
    song: SongData,
  ): Promise<EngineDocument> {
    const workspace = workspaces.require();
    const settings = await workspace.settings.getAll();
    const doc = generateSongDocument({
      songId,
      title: song.title,
      artist: song.artist,
      copyrightOwner: song.copyrightOwner,
      copyrightYear: song.copyrightYear,
      ccliNumber: song.ccliNumber,
      sections: song.sections,
      arrangement: song.arrangement,
      split: song.split ?? settings["songs.split"],
      templateId: song.templateId,
      background: await background(workspace, song.backgroundAssetId),
      showCopyright: settings["songs.showCopyright"],
    });
    return engineDocumentSchema.parse(doc);
  }

  /** §3.6: regenerate a song that is in the running session and patch it. */
  async function patchLive(record: SongRecord): Promise<void> {
    const controller = options.live();
    const itemIds = controller.itemsForSong(record.id);
    if (itemIds.length === 0) return;
    const doc = await generate(record.id, record);
    for (const itemId of itemIds) {
      const result = controller.replaceItemDocument(itemId, doc);
      logger.info(
        `[songs] live edit of “${record.title}”: ${result.patched} slide(s) patched${result.reloaded ? ", item reloaded" : ""}`,
      );
    }
  }

  function fromParsed(parsed: ParsedSong): SongData {
    const ids = parsed.sections.map(() => newId());
    return {
      title: parsed.title.slice(0, 200),
      artist: parsed.artist?.slice(0, 200) ?? null,
      language: "en",
      category: null,
      copyrightOwner: parsed.copyrightOwner?.slice(0, 200) ?? null,
      copyrightYear: parsed.copyrightYear,
      ccliNumber:
        parsed.ccliNumber && /^\d{1,12}$/.test(parsed.ccliNumber)
          ? parsed.ccliNumber
          : null,
      licenceReference: null,
      tags: parsed.tags.slice(0, 30).map((tag) => tag.slice(0, 40)),
      collectionIds: [],
      backgroundAssetId: null,
      templateId: null,
      split: null,
      sections: parsed.sections.map((section, index) => ({
        id: ids[index]!,
        type: section.type,
        label: section.label.slice(0, 40),
        lyrics: section.lyrics.slice(0, 10_000),
      })),
      arrangement: parsed.arrangement
        .map((index) => ids[index]!)
        .filter(Boolean),
    };
  }

  const summary = (song: SongRecord): SongListItem => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    language: song.language,
    sectionCount: song.sections.length,
    snippet: null,
  });

  return {
    generate,

    async list(search: {
      query?: string | undefined;
      collectionId?: string | undefined;
      language?: string | undefined;
      limit: number;
    }) {
      return (await repo()).search(search);
    },

    async get(id: string): Promise<SongDetail> {
      const song = await (await repo()).get(id);
      if (!song) throw new AppError("NOT_FOUND", "Song not found");
      return song;
    },

    async create(data: SongData): Promise<SongDetail> {
      return (await repo()).create(data);
    },

    async update(id: string, data: SongData): Promise<SongDetail> {
      const record = await (await repo()).update(id, data);
      await patchLive(record).catch((error: unknown) =>
        logger.error("[songs] live patch failed", error),
      );
      return record;
    },

    async delete(id: string): Promise<void> {
      await (await repo()).delete(id);
    },

    parseLyrics(text: string): Pick<SongData, "sections" | "arrangement"> {
      const parsed = parseLyrics(text);
      const { sections, arrangement } = fromParsed({
        title: "draft",
        artist: null,
        copyrightOwner: null,
        copyrightYear: null,
        ccliNumber: null,
        tags: [],
        ...parsed,
      });
      return { sections, arrangement };
    },

    preview(data: SongData): Promise<EngineDocument> {
      return generate("draft", data);
    },

    async collections() {
      return (await repo()).collections();
    },

    async createCollection(name: string) {
      return (await repo()).createCollection(name);
    },

    templates() {
      return SONG_TEMPLATES.map(({ id, name }) => ({ id, name }));
    },

    /** Parses song files in the worker, then saves each as a new song. */
    async import(paths?: string[]): Promise<{
      imported: SongListItem[];
      failed: { name: string; message: string }[];
    }> {
      const songs = await repo();
      const files = paths ?? (await options.chooseFiles());
      if (files.some((path) => !isAbsolute(path)))
        throw new AppError("VALIDATION_ERROR", "Import paths must be absolute");
      if (files.length === 0) return { imported: [], failed: [] };
      const { done } = options.jobs.start({ kind: "songs", files }, () => {});
      const result = await done;
      const imported: SongListItem[] = [];
      const failed: { name: string; message: string }[] = [];
      for (const entry of result.songs ?? []) {
        if (!entry.ok) {
          failed.push({ name: entry.name, message: entry.message });
          continue;
        }
        imported.push(summary(await songs.create(fromParsed(entry.song))));
      }
      logger.info(
        `[songs] imported ${imported.length}, failed ${failed.length}`,
      );
      return { imported, failed };
    },

    /** Adds a song to the running session's playlist. */
    async queueSong(songId: string): Promise<LiveState> {
      const song = await this.get(songId);
      return options.live().appendItem({
        id: `song:${song.id}`,
        title: song.title,
        kind: "song",
        doc: await generate(song.id, song),
        songId: song.id,
      });
    },
  };
}

export type SongService = ReturnType<typeof createSongService>;
