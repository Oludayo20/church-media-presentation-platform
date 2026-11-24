import { create } from "zustand";
import type {
  JobProgress,
  MediaDetail,
  MediaFolderInfo,
  MediaItem,
  MediaTypeName,
} from "@cmp/shared-types";
import type { MediaCategory } from "@cmp/shared-validation";
import { errorMessage, IpcClientError, unwrap } from "../../lib/ipc";

export interface MediaFilter {
  /** `"all"` = every folder, `null` = root. */
  folderId: string | null | "all";
  mediaType: MediaTypeName | null;
  category: MediaCategory | null;
  tag: string | null;
  query: string;
  favourite: boolean;
  missing: boolean;
}

const EMPTY_FILTER: MediaFilter = {
  folderId: "all",
  mediaType: null,
  category: null,
  tag: null,
  query: "",
  favourite: false,
  missing: false,
};

interface MediaStore {
  filter: MediaFilter;
  view: "grid" | "list";
  items: MediaItem[];
  nextCursor: string | null;
  loading: boolean;
  folders: MediaFolderInfo[];
  tags: { name: string; count: number }[];
  selectedId: string | null;
  detail: MediaDetail | null;
  jobs: Record<string, JobProgress>;
  error: string | null;
  /** Set when a delete was blocked: what still uses the asset. */
  blockedBy: MediaDetail["usedBy"] | null;

  connect(): () => void;
  setFilter(patch: Partial<MediaFilter>): void;
  resetFilter(): void;
  setView(view: "grid" | "list"): void;
  reload(): Promise<void>;
  loadMore(): Promise<void>;
  refreshMeta(): Promise<void>;
  select(id: string | null): Promise<void>;
  run<T>(action: () => Promise<T>): Promise<T | null>;
  importPaths(paths: string[]): Promise<void>;
  dismissJob(jobId: string): void;
  dismissError(): void;
}

function listInput(filter: MediaFilter, cursor?: string) {
  return {
    ...(filter.folderId !== "all" && { folderId: filter.folderId }),
    ...(filter.mediaType && { mediaType: filter.mediaType }),
    ...(filter.category && { category: filter.category }),
    ...(filter.tag && { tag: filter.tag }),
    ...(filter.query.trim() && { query: filter.query.trim() }),
    ...(filter.favourite && { favourite: true }),
    ...(filter.missing && { missing: true }),
    ...(cursor && { cursor }),
    limit: 60,
  };
}

let reloadToken = 0;

export const useMediaStore = create<MediaStore>()((set, get) => ({
  filter: EMPTY_FILTER,
  view: "grid",
  items: [],
  nextCursor: null,
  loading: false,
  folders: [],
  tags: [],
  selectedId: null,
  detail: null,
  jobs: {},
  error: null,
  blockedBy: null,

  connect() {
    const offJobs = window.cmp.jobs.onProgress((progress) =>
      set((state) => ({ jobs: { ...state.jobs, [progress.jobId]: progress } })),
    );
    const offChanged = window.cmp.media.onChanged(() => {
      void get().reload();
      void get().refreshMeta();
      const selected = get().selectedId;
      if (selected) void get().select(selected);
    });
    void get().reload();
    void get().refreshMeta();
    return () => {
      offJobs();
      offChanged();
    };
  },

  setFilter(patch) {
    set((state) => ({ filter: { ...state.filter, ...patch } }));
    void get().reload();
  },

  resetFilter() {
    set({ filter: EMPTY_FILTER });
    void get().reload();
  },

  setView: (view) => set({ view }),

  async reload() {
    const token = ++reloadToken;
    set({ loading: true });
    const page = await get().run(() =>
      unwrap(window.cmp.media.list(listInput(get().filter))),
    );
    if (token !== reloadToken) return; // a newer filter won
    set({
      loading: false,
      items: page?.items ?? [],
      nextCursor: page?.nextCursor ?? null,
    });
  },

  async loadMore() {
    const cursor = get().nextCursor;
    if (!cursor || get().loading) return;
    set({ loading: true });
    const page = await get().run(() =>
      unwrap(window.cmp.media.list(listInput(get().filter, cursor))),
    );
    set((state) => ({
      loading: false,
      items: [...state.items, ...(page?.items ?? [])],
      nextCursor: page?.nextCursor ?? null,
    }));
  },

  async refreshMeta() {
    const [folders, tags] = await Promise.all([
      get().run(() => unwrap(window.cmp.media.folders())),
      get().run(() => unwrap(window.cmp.media.tags())),
    ]);
    set({ folders: folders ?? [], tags: tags ?? [] });
  },

  async select(id) {
    set({
      selectedId: id,
      blockedBy: null,
      ...(id === null && { detail: null }),
    });
    if (!id) return;
    const detail = await get().run(() => unwrap(window.cmp.media.get({ id })));
    if (get().selectedId === id) set({ detail });
  },

  async run(action) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof IpcClientError && error.code === "CONFLICT") {
        const usedBy = (
          error.details as { usedBy?: MediaDetail["usedBy"] } | undefined
        )?.usedBy;
        if (usedBy) {
          set({ blockedBy: usedBy });
          return null;
        }
      }
      set({ error: errorMessage(error), loading: false });
      return null;
    }
  },

  async importPaths(paths) {
    if (paths.length === 0) return;
    const folderId = get().filter.folderId;
    await get().run(() =>
      unwrap(
        window.cmp.media.import({
          paths,
          ...(folderId !== "all" && { folderId }),
        }),
      ),
    );
  },

  dismissJob: (jobId) =>
    set((state) => {
      const jobs = { ...state.jobs };
      delete jobs[jobId];
      return { jobs };
    }),

  dismissError: () => set({ error: null }),
}));
