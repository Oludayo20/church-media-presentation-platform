import type { WorkspaceSummary } from "@cmp/shared-types";
import type { Settings } from "@cmp/shared-validation";
import { useNavigationStore } from "../../app/stores/navigation-store";
import { useWorkspaceStore } from "../../app/stores/workspace-store";
import { useEffect } from "react";
import { useImportedFonts } from "../fonts/fonts-store";
import { PresentationsPage } from "../presentations/PresentationsPage";
import { BiblePage } from "../bible/BiblePage";
import { HomePage } from "../home/HomePage";
import { LivePage } from "../live/LivePage";
import { MediaPage } from "../media/MediaPage";
import { SongsPage } from "../songs/SongsPage";
import { LiveToasts } from "../live/components/LiveToasts";
import { useLiveStore } from "../live/live-store";
import { SettingsPage } from "../settings/SettingsPage";
import { ModulePlaceholder } from "./ModulePlaceholder";
import { MODULES } from "./modules";
import { Sidebar } from "./Sidebar";

interface AppShellProps {
  workspace: WorkspaceSummary;
  settings: Settings;
}

export function AppShell({ workspace, settings }: AppShellProps) {
  const presentationId = useNavigationStore((state) => state.presentationId);
  const moduleId = useNavigationStore((state) => state.module);
  const setSetting = useWorkspaceStore((state) => state.setSetting);
  const module = MODULES.find((candidate) => candidate.id === moduleId)!;
  const connect = useLiveStore((state) => state.connect);
  useEffect(() => connect(), [connect]);
  useImportedFonts();

  return (
    <div className="flex h-screen">
      <Sidebar
        workspace={workspace}
        theme={settings["ui.theme"]}
        onThemeChange={(theme) => void setSetting("ui.theme", theme)}
      />
      <main
        className="min-w-0 flex-1 overflow-y-auto"
        aria-label={module.label}
      >
        {module.id === "live" ? (
          <LivePage />
        ) : module.id === "media" ? (
          <MediaPage />
        ) : module.id === "songs" ? (
          <SongsPage />
        ) : module.id === "presentations" ? (
          <PresentationsPage initialId={presentationId} />
        ) : module.id === "bible" ? (
          <BiblePage />
        ) : module.id === "home" ? (
          <HomePage workspace={workspace} settings={settings} />
        ) : module.id === "settings" ? (
          <SettingsPage workspace={workspace} settings={settings} />
        ) : (
          <ModulePlaceholder module={module} />
        )}
      </main>
      <LiveToasts />
    </div>
  );
}
