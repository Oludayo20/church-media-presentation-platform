import { useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@cmp/design-system";
import { useWorkspaceStore } from "../../app/stores/workspace-store";
import { errorMessage } from "../../lib/ipc";
import { ChurchBadge } from "../shell/ChurchBadge";

/** Choose / replace / remove the church logo (native dialog in main). */
export function LogoPicker({ logoAssetId }: { logoAssetId: string | null }) {
  const chooseLogo = useWorkspaceStore((state) => state.chooseLogo);
  const removeLogo = useWorkspaceStore((state) => state.removeLogo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <ChurchBadge logoAssetId={logoAssetId} className="size-20" />
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(chooseLogo)}
          >
            <Upload className="size-4" aria-hidden />
            {logoAssetId ? "Replace logo" : "Choose logo…"}
          </Button>
          {logoAssetId && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run(removeLogo)}
            >
              <Trash2 className="size-4" aria-hidden />
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">
          PNG, JPEG, WebP or GIF, up to 20 MB.
        </p>
        {error && (
          <p role="alert" className="text-sm text-live">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
