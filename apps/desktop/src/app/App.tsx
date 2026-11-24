import { useEffect } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@cmp/design-system";
import { AppShell } from "../features/shell/AppShell";
import { Onboarding } from "../features/onboarding/Onboarding";
import { useApplyTheme } from "../features/theme/useApplyTheme";
import { useWorkspaceStore } from "./stores/workspace-store";

export function App() {
  const { phase, loadError, workspace, settings, load } = useWorkspaceStore();

  useEffect(() => {
    void load();
  }, [load]);

  useApplyTheme(settings?.["ui.theme"] ?? "dark");

  if (phase === "loading") {
    return (
      <div className="flex h-screen items-center justify-center text-muted">
        <LoaderCircle className="size-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-10 text-center">
        <CircleAlert className="size-8 text-live" aria-hidden />
        <h1 className="text-xl font-semibold">Could not load your workspace</h1>
        <p className="max-w-md text-sm text-muted">{loadError}</p>
        <Button onClick={() => void load()}>Try again</Button>
      </div>
    );
  }

  if (workspace.status !== "ready" || !settings) {
    return <Onboarding workspace={workspace} settings={settings} />;
  }

  return <AppShell workspace={workspace.workspace} settings={settings} />;
}
