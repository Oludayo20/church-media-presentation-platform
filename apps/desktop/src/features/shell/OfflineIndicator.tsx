import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@cmp/design-system";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";

/**
 * Nothing in the presentation path needs the network (DOCUMENTATION.md
 * §9.5), so offline is informational, not an error.
 */
export function OfflineIndicator() {
  const online = useOnlineStatus();
  return (
    <div
      data-testid="network-status"
      data-online={online}
      role="status"
      title={
        online
          ? "Connected to the internet"
          : "Offline: everything except Downloads and updates keeps working"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs",
        online ? "text-muted" : "bg-warning/15 text-warning",
      )}
    >
      {online ? (
        <Wifi className="size-3.5" aria-hidden />
      ) : (
        <WifiOff className="size-3.5" aria-hidden />
      )}
      {online ? "Online" : "Offline"}
    </div>
  );
}
