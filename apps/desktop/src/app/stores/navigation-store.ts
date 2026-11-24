import { create } from "zustand";
import type { ModuleId } from "../../features/shell/modules";

interface NavigationStore {
  module: ModuleId;
  presentationId?: string | undefined;
  navigate(module: ModuleId, presentationId?: string): void;
}

/** Which module the shell shows. Deep routes arrive with the editors. */
export const useNavigationStore = create<NavigationStore>()((set) => ({
  module: "home",
  navigate: (module, presentationId) => set({ module, presentationId }),
}));
