import { Church } from "lucide-react";
import { cn } from "@cmp/design-system";
import { mediaUrl } from "../../lib/media";

interface ChurchBadgeProps {
  logoAssetId: string | null;
  className?: string;
}

/** The church logo (served over cmp-media://) or a neutral fallback mark. */
export function ChurchBadge({ logoAssetId, className }: ChurchBadgeProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-raised",
        className,
      )}
    >
      {logoAssetId ? (
        <img
          data-testid="church-logo"
          src={mediaUrl(logoAssetId)}
          alt="Church logo"
          className="size-full object-contain"
        />
      ) : (
        <Church className="size-1/2 text-muted" aria-hidden />
      )}
    </div>
  );
}
