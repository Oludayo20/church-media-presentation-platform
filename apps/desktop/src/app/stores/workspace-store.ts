import { create } from "zustand";
import type { WorkspaceState } from "@cmp/shared-types";
import type { SettingKey, Settings } from "@cmp/shared-validation";
import { errorMessage, unwrap } from "../../lib/ipc";

interface WorkspaceStore {
  phase: "loading" | "error" | "loaded";
  loadError: string | null;
  workspace: WorkspaceState;
  /** Null until a workspace exists. */
  settings: Settings | null;

  load(): Promise<void>;
  createWorkspace(churchName: string): Promise<void>;
  renameWorkspace(churchName: string): Promise<void>;
  chooseLogo(): Promise<void>;
  removeLogo(): Promise<void>;
  completeOnboarding(): Promise<void>;
  setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void>;
}

/**
 * Renderer-side copy of the workspace and its settings. The database stays
 * the source of truth: every action round-trips through IPC and stores what
 * main returns. Actions throw `IpcClientError` so forms can show the message.
 */
export const useWorkspaceStore = create<WorkspaceStore>()((set) => {
  async function refreshSettings(workspace: WorkspaceState) {
    const settings =
      workspace.status === "none"
        ? null
        : await unwrap(window.cmp.settings.get());
    set({ workspace, settings });
  }

  return {
    phase: "loading",
    loadError: null,
    workspace: { status: "none" },
    settings: null,

    async load() {
      set({ phase: "loading", loadError: null });
      try {
        await refreshSettings(await unwrap(window.cmp.workspace.get()));
        set({ phase: "loaded" });
      } catch (error) {
        set({ phase: "error", loadError: errorMessage(error) });
      }
    },

    async createWorkspace(churchName) {
      await refreshSettings(
        await unwrap(window.cmp.workspace.create({ churchName })),
      );
    },

    async renameWorkspace(churchName) {
      set({
        workspace: await unwrap(window.cmp.workspace.rename({ churchName })),
      });
    },

    async chooseLogo() {
      set({ workspace: await unwrap(window.cmp.workspace.chooseLogo()) });
    },

    async removeLogo() {
      set({ workspace: await unwrap(window.cmp.workspace.removeLogo()) });
    },

    async completeOnboarding() {
      await refreshSettings(
        await unwrap(window.cmp.workspace.completeOnboarding()),
      );
    },

    async setSetting(key, value) {
      const settings = await unwrap(
        window.cmp.settings.set({ key, value } as Parameters<
          typeof window.cmp.settings.set
        >[0]),
      );
      set({ settings });
    },
  };
});
