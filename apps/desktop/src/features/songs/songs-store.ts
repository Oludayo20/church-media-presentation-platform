import { create } from "zustand";
import type {
  SongCollectionInfo,
  SongData,
  SongListItem,
} from "@cmp/shared-types";
import type { EngineDocument } from "@cmp/shared-validation";
import { errorMessage, unwrap } from "../../lib/ipc";

export function newSongData(): SongData {
  return {
    title: "",
    artist: null,
    language: "en",
    category: null,
    copyrightOwner: null,
    copyrightYear: null,
    ccliNumber: null,
    licenceReference: null,
    tags: [],
    collectionIds: [],
    backgroundAssetId: null,
    templateId: null,
    split: null,
    sections: [],
    arrangement: [],
  };
}

export function sectionId(): string {
  return crypto.randomUUID();
}

interface SongsStore {
  query: string;
  collectionId: string | null;
  songs: SongListItem[];
  collections: SongCollectionInfo[];
  templates: { id: string; name: string }[];
  /** The song being edited; `id` null for a new song. */
  editing: { id: string | null; data: SongData } | null;
  saved: string | null;
  preview: EngineDocument | null;
  previewError: string | null;
  error: string | null;
  notice: string | null;

  init(): Promise<void>;
  search(patch: {
    query?: string;
    collectionId?: string | null;
  }): Promise<void>;
  open(id: string): Promise<void>;
  startNew(): void;
  close(): void;
  change(patch: Partial<SongData>): void;
  save(): Promise<boolean>;
  remove(): Promise<void>;
  importSongs(paths?: string[]): Promise<void>;
  refreshPreview(): Promise<void>;
  run<T>(action: () => Promise<T>): Promise<T | null>;
  dismiss(): void;
}

let previewTimer: ReturnType<typeof setTimeout> | undefined;
let searchToken = 0;

export const useSongsStore = create<SongsStore>()((set, get) => ({
  query: "",
  collectionId: null,
  songs: [],
  collections: [],
  templates: [],
  editing: null,
  saved: null,
  preview: null,
  previewError: null,
  error: null,
  notice: null,

  async init() {
    const [collections, templates] = await Promise.all([
      get().run(() => unwrap(window.cmp.songs.collections())),
      get().run(() => unwrap(window.cmp.songs.templates())),
    ]);
    set({ collections: collections ?? [], templates: templates ?? [] });
    await get().search({});
  },

  async search(patch) {
    set(patch as Partial<SongsStore>);
    const token = ++searchToken;
    const { query, collectionId } = get();
    const songs = await get().run(() =>
      unwrap(
        window.cmp.songs.list({
          ...(query.trim() && { query: query.trim() }),
          ...(collectionId && { collectionId }),
        }),
      ),
    );
    if (token === searchToken) set({ songs: songs ?? [] });
  },

  async open(id) {
    const song = await get().run(() => unwrap(window.cmp.songs.get({ id })));
    if (!song) return;
    const { id: _id, createdAt: _c, updatedAt: _u, ...data } = song;
    set({ editing: { id, data }, saved: JSON.stringify(data), notice: null });
    void get().refreshPreview();
  },

  startNew() {
    const data = newSongData();
    set({
      editing: { id: null, data },
      saved: null,
      preview: null,
      notice: null,
    });
  },

  close: () => set({ editing: null, saved: null, preview: null }),

  change(patch) {
    const editing = get().editing;
    if (!editing) return;
    set({ editing: { ...editing, data: { ...editing.data, ...patch } } });
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void get().refreshPreview(), 250);
  },

  async refreshPreview() {
    const editing = get().editing;
    if (!editing || !editing.data.title.trim()) {
      set({ preview: null });
      return;
    }
    try {
      set({
        preview: await unwrap(window.cmp.songs.preview({ song: editing.data })),
        previewError: null,
      });
    } catch (error) {
      set({ previewError: errorMessage(error) });
    }
  },

  async save() {
    const editing = get().editing;
    if (!editing) return false;
    const song = await get().run(() =>
      unwrap(
        editing.id
          ? window.cmp.songs.update({ id: editing.id, song: editing.data })
          : window.cmp.songs.create({ song: editing.data }),
      ),
    );
    if (!song) return false;
    const { id, createdAt: _c, updatedAt: _u, ...data } = song;
    set({
      editing: { id, data },
      saved: JSON.stringify(data),
      notice: "Saved",
    });
    await Promise.all([get().search({}), get().init()]);
    return true;
  },

  async remove() {
    const id = get().editing?.id;
    if (!id) return get().close();
    const result = await get().run(() =>
      unwrap(window.cmp.songs.delete({ id })),
    );
    if (result) {
      get().close();
      await get().init();
    }
  },

  async importSongs(paths) {
    const result = await get().run(() =>
      unwrap(window.cmp.songs.import(paths ? { paths } : {})),
    );
    if (!result) return;
    const parts = [
      result.imported.length && `${result.imported.length} imported`,
      result.failed.length &&
        `${result.failed.length} failed (${result.failed.map((f) => `${f.name}: ${f.message}`).join("; ")})`,
    ].filter(Boolean);
    set({ notice: parts.join(" · ") || "Nothing imported" });
    await get().init();
    if (result.imported[0]) await get().open(result.imported[0].id);
  },

  async run(action) {
    try {
      return await action();
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    }
  },

  dismiss: () => set({ error: null, notice: null }),
}));

export function useDirty(): boolean {
  return useSongsStore((state) =>
    state.editing
      ? state.saved === null ||
        JSON.stringify(state.editing.data) !== state.saved
      : false,
  );
}
