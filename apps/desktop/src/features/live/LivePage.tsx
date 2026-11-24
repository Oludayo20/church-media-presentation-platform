import { LoaderCircle } from "lucide-react";
import { useLiveStore } from "./live-store";
import { LiveSetup } from "./components/LiveSetup";
import { LiveWorkspace } from "./components/LiveWorkspace";

export function LivePage() {
  const live = useLiveStore((state) => state.live);
  const displays = useLiveStore((state) => state.displays);
  if (!live || !displays) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <LoaderCircle className="size-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  return live.status === "idle" || live.status === "preparing" ? (
    <LiveSetup live={live} displays={displays} />
  ) : (
    <LiveWorkspace live={live} displays={displays} />
  );
}
