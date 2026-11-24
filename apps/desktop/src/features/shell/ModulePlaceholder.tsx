import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import type { ModuleDefinition } from "./modules";

/** Stand-in page for modules that later phases build. */
export function ModulePlaceholder({ module }: { module: ModuleDefinition }) {
  const online = useOnlineStatus();
  const Icon = module.icon;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl bg-primary/15">
        <Icon className="size-7 text-primary" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold">{module.label}</h1>
      <p className="max-w-md text-sm text-muted">{module.description}</p>
      {module.id === "downloads" && !online && (
        <p className="inline-flex items-center gap-2 text-sm text-warning">
          <WifiOff className="size-4" aria-hidden />
          Downloads need an internet connection.
        </p>
      )}
      {module.arrivesIn && (
        <p className="rounded-full border border-border px-3 py-1 text-xs text-muted">
          Coming in {module.arrivesIn}
        </p>
      )}
    </div>
  );
}
