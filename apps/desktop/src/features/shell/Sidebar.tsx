import { cn } from "@cmp/design-system";
import type { WorkspaceSummary } from "@cmp/shared-types";
import type { Theme } from "@cmp/shared-validation";
import { useNavigationStore } from "../../app/stores/navigation-store";
import { useLiveStore } from "../live/live-store";
import { ChurchBadge } from "./ChurchBadge";
import { MODULES } from "./modules";
import { OfflineIndicator } from "./OfflineIndicator";
import { ThemeSwitch } from "./ThemeSwitch";

interface SidebarProps {
  workspace: WorkspaceSummary;
  theme: Theme;
  onThemeChange(theme: Theme): void;
}

export function Sidebar({ workspace, theme, onThemeChange }: SidebarProps) {
  const current = useNavigationStore((state) => state.module);
  const navigate = useNavigationStore((state) => state.navigate);
  const liveStatus = useLiveStore((state) => state.live?.status ?? "idle");

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-3 px-4 py-4">
        <ChurchBadge logoAssetId={workspace.logoAssetId} className="size-9" />
        <div className="min-w-0">
          <p
            data-testid="church-name"
            className="truncate text-sm font-semibold"
            title={workspace.churchName}
          >
            {workspace.churchName}
          </p>
          <p className="text-xs text-muted">Church Media</p>
        </div>
      </div>

      <nav aria-label="Modules" className="flex-1 overflow-y-auto px-2">
        <ul className="space-y-0.5">
          {MODULES.map(({ id, label, icon: Icon }) => {
            const active = id === current;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => navigate(id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary/15 font-medium text-foreground"
                      : "text-muted hover:bg-surface-raised hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn("size-4", active && "text-primary")}
                    aria-hidden
                  />
                  {label}
                  {id === "live" && liveStatus !== "idle" && (
                    <span
                      data-testid="nav-live-dot"
                      className={cn(
                        "ml-auto size-2 rounded-full",
                        liveStatus === "suspended"
                          ? "animate-pulse bg-live"
                          : "bg-live",
                      )}
                      aria-label="Live session running"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-3">
        <OfflineIndicator />
        <ThemeSwitch value={theme} onChange={onThemeChange} />
      </div>
    </aside>
  );
}
