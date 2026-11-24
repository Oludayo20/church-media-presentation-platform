import { create } from "zustand";
import type { DisplayStatus, LiveState } from "@cmp/shared-types";
import type { EngineDocument } from "@cmp/shared-validation";
import { errorMessage, unwrap } from "../../lib/ipc";

interface LiveStore {
  live: LiveState | null;
  displays: DisplayStatus | null;
  error: string | null;
  /** Resolved documents for the current session, by item index. */
  documents: Record<string, EngineDocument>;

  /** Subscribes to push events and loads the current state. */
  connect(): () => void;
  /** Runs an IPC action, storing any error for the toast. */
  run(action: () => Promise<unknown>): Promise<void>;
  dismissError(): void;
  loadDocument(itemIndex: number): Promise<void>;
}

/** Cache key: a live edit bumps the item's revision, so previews refetch. */
const docKey = (live: LiveState | null, itemIndex: number) =>
  `${live?.sessionId ?? "none"}:${itemIndex}:${live?.items[itemIndex]?.id ?? ""}:${live?.items[itemIndex]?.revision ?? 0}`;

export const useLiveStore = create<LiveStore>()((set, get) => ({
  live: null,
  displays: null,
  error: null,
  documents: {},

  connect() {
    const offLive = window.cmp.live.onState((live) => set({ live }));
    const offDisplays = window.cmp.displays.onChanged((displays) =>
      set({ displays }),
    );
    void get().run(async () => {
      const [live, displays] = await Promise.all([
        unwrap(window.cmp.live.getState()),
        unwrap(window.cmp.displays.list()),
      ]);
      set({ live, displays });
    });
    return () => {
      offLive();
      offDisplays();
    };
  },

  async run(action) {
    try {
      const result = await action();
      if (result && typeof result === "object") {
        if ("status" in result && "items" in result)
          set({ live: result as LiveState });
        else if ("displays" in result && "newDisplayId" in result)
          set({ displays: result as DisplayStatus });
      }
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  dismissError: () => set({ error: null }),

  async loadDocument(itemIndex) {
    const key = docKey(get().live, itemIndex);
    if (get().documents[key]) return;
    try {
      const doc = await unwrap(window.cmp.live.document({ itemIndex }));
      set((state) => ({ documents: { ...state.documents, [key]: doc } }));
    } catch {
      // The session ended or the item vanished; previews just stay empty.
    }
  },
}));

export function useDocument(itemIndex: number | null): EngineDocument | null {
  return useLiveStore((state) =>
    itemIndex === null
      ? null
      : (state.documents[docKey(state.live, itemIndex)] ?? null),
  );
}

/** Shorthand for an IPC call through the store (errors → toast). */
export function act(call: () => Promise<unknown>): void {
  void useLiveStore.getState().run(() => unwrap(call() as Promise<never>));
}
