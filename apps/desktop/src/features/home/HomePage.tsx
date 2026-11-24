import { CalendarDays, Monitor, Radio, type LucideIcon } from "lucide-react";
import { Button } from "@cmp/design-system";
import type { WorkspaceSummary } from "@cmp/shared-types";
import { OUTPUT_RESOLUTIONS, type Settings } from "@cmp/shared-validation";
import { useNavigationStore } from "../../app/stores/navigation-store";
import { ChurchBadge } from "../shell/ChurchBadge";

interface HomePageProps {
  workspace: WorkspaceSummary;
  settings: Settings;
}

/**
 * Phase 1 home. Recent items, favourite songs, display status and storage
 * join it in Phase 8 (docs/TASKS.md "Home dashboard").
 */
export function HomePage({ workspace, settings }: HomePageProps) {
  const navigate = useNavigationStore((state) => state.navigate);
  const { w, h } = settings["display.outputResolution"];
  const resolutionLabel =
    OUTPUT_RESOLUTIONS.find((r) => r.w === w && r.h === h)?.label ??
    `${w} × ${h}`;

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-10">
      <header className="flex items-center gap-4">
        <ChurchBadge logoAssetId={workspace.logoAssetId} className="size-14" />
        <div>
          <p className="text-sm text-muted">Welcome back</p>
          <h1 className="text-2xl font-semibold">{workspace.churchName}</h1>
        </div>
      </header>

      <section aria-label="Quick actions" className="grid gap-3 sm:grid-cols-2">
        <QuickAction
          icon={Radio}
          title="Go live"
          body="Run a service on the projector."
          note="Arrives in Phase 3"
        />
        <QuickAction
          icon={CalendarDays}
          title="Plan a service"
          body="Songs, scripture, media and notices in order."
          note="Arrives in Phase 8"
        />
      </section>

      <section className="flex items-center justify-between rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-3">
          <Monitor className="size-5 text-muted" aria-hidden />
          <div>
            <p className="text-sm font-medium">Audience output</p>
            <p data-testid="home-resolution" className="text-sm text-muted">
              {resolutionLabel} · {w} × {h}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate("settings")}
        >
          Change
        </Button>
      </section>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  title,
  body,
  note,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 opacity-80">
      <Icon className="size-5 text-primary" aria-hidden />
      <p className="mt-3 font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
      <p className="mt-3 text-xs text-muted">{note}</p>
    </div>
  );
}
