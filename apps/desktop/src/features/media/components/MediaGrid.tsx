import { CircleAlert, RefreshCw, Star } from "lucide-react";
import { cn } from "@cmp/design-system";
import type { MediaItem } from "@cmp/shared-types";
import { MEDIA_CATEGORIES } from "@cmp/shared-validation";
import { unwrap } from "../../../lib/ipc";
import { formatBytes, formatDuration } from "../format";
import { useMediaStore } from "../media-store";
import { MediaThumb } from "./MediaThumb";

export function MediaGrid({ items }: { items: MediaItem[] }) {
  const { view, selectedId, select } = useMediaStore();
  if (view === "list") return <MediaTable items={items} />;
  return (
    <ul
      aria-label="Media"
      className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
    >
      {items.map((item) => (
        <li key={item.id} className="group relative">
          <button
            type="button"
            data-testid="media-card"
            aria-pressed={item.id === selectedId}
            onClick={() => void select(item.id)}
            className={cn(
              "group w-full overflow-hidden rounded-lg border bg-surface text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              item.id === selectedId
                ? "border-primary"
                : "border-border hover:border-muted",
            )}
          >
            <div className="relative">
              <MediaThumb item={item} className="aspect-video w-full" />
              <Badges item={item} />
            </div>
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium" title={item.name}>
                {item.name}
              </p>
              <p className="text-xs text-muted">
                {formatBytes(item.fileSize)}
                {item.width && item.height
                  ? ` · ${item.width}×${item.height}`
                  : ""}
              </p>
            </div>
          </button>
          <FavouriteStar item={item} className="absolute right-1.5 top-1.5" />
        </li>
      ))}
    </ul>
  );
}

function Badges({ item }: { item: MediaItem }) {
  const duration = formatDuration(item.durationMs);
  return (
    <>
      <div className="absolute left-1.5 top-1.5 flex gap-1">
        {item.isMissing && (
          <span
            data-testid="missing-badge"
            className="inline-flex items-center gap-1 rounded bg-live px-1.5 py-0.5 text-[11px] font-semibold text-live-foreground"
          >
            <CircleAlert className="size-3" aria-hidden />
            Missing
          </span>
        )}
        {item.transcodeReason && (
          <span className="inline-flex items-center gap-1 rounded bg-warning px-1.5 py-0.5 text-[11px] font-semibold text-black">
            <RefreshCw className="size-3" aria-hidden />
            Convert
          </span>
        )}
      </div>
      {duration && (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
          {duration}
        </span>
      )}
    </>
  );
}

export function FavouriteStar({
  item,
  className,
}: {
  item: MediaItem;
  className?: string;
}) {
  const { run, reload } = useMediaStore();
  return (
    <button
      type="button"
      aria-label={
        item.isFavourite ? `Unfavourite ${item.name}` : `Favourite ${item.name}`
      }
      aria-pressed={item.isFavourite}
      onClick={async () => {
        await run(() =>
          unwrap(
            window.cmp.media.update({
              id: item.id,
              patch: { isFavourite: !item.isFavourite },
            }),
          ),
        );
        await reload();
      }}
      className={cn(
        "rounded-full bg-black/50 p-1 text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        item.isFavourite ? "text-warning" : "opacity-0 group-hover:opacity-100",
        className,
      )}
    >
      <Star className={cn("size-3.5", item.isFavourite && "fill-current")} />
    </button>
  );
}

function MediaTable({ items }: { items: MediaItem[] }) {
  const { selectedId, select } = useMediaStore();
  return (
    <table aria-label="Media" className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="w-16 py-2" />
          <th className="py-2">Name</th>
          <th className="py-2">Category</th>
          <th className="py-2">Size</th>
          <th className="py-2">Length</th>
          <th className="py-2">Tags</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={item.id}
            data-testid="media-row"
            aria-selected={item.id === selectedId}
            onClick={() => void select(item.id)}
            className={cn(
              "cursor-pointer border-t border-border",
              item.id === selectedId
                ? "bg-primary/10"
                : "hover:bg-surface-raised",
            )}
          >
            <td className="py-1.5">
              <MediaThumb
                item={item}
                hoverPreview={false}
                className="h-9 w-16 rounded"
              />
            </td>
            <td className="py-1.5 font-medium">
              {item.name}
              {item.isMissing && (
                <span className="ml-2 text-xs text-live">Missing</span>
              )}
            </td>
            <td className="py-1.5 text-muted">
              {item.category
                ? (MEDIA_CATEGORIES[
                    item.category as keyof typeof MEDIA_CATEGORIES
                  ] ?? item.category)
                : "—"}
            </td>
            <td className="py-1.5 tabular-nums text-muted">
              {formatBytes(item.fileSize)}
            </td>
            <td className="py-1.5 tabular-nums text-muted">
              {formatDuration(item.durationMs) ?? "—"}
            </td>
            <td className="py-1.5 text-muted">{item.tags.join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
