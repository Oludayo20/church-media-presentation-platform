import { useEffect, useState } from "react";
import { cn } from "@cmp/design-system";
import type { MediaItem } from "@cmp/shared-types";
import { unwrap } from "../../../lib/ipc";
import { MediaThumb } from "../../media/components/MediaThumb";

/** Pick a motion background or image from the media library. */
export function BackgroundPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange(id: string | null): void;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all([
      unwrap(window.cmp.media.list({ mediaType: "video", limit: 60 })),
      unwrap(window.cmp.media.list({ mediaType: "image", limit: 60 })),
    ]).then(
      ([videos, images]) =>
        live &&
        setItems(
          [...videos.items, ...images.items].filter((item) => !item.isMissing),
        ),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Background"
      className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        onClick={() => onChange(null)}
        className={cn(
          "flex aspect-video items-center justify-center rounded-md border bg-gradient-to-br from-[#1b1f3b] to-[#3d2c6b] text-xs text-white",
          value === null
            ? "border-primary ring-2 ring-primary"
            : "border-border",
        )}
      >
        Default
      </button>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={value === item.id}
          aria-label={item.name}
          title={item.name}
          onClick={() => onChange(item.id)}
          className={cn(
            "overflow-hidden rounded-md border",
            value === item.id
              ? "border-primary ring-2 ring-primary"
              : "border-border",
          )}
        >
          <MediaThumb item={item} className="aspect-video w-full" />
        </button>
      ))}
      {items.length === 0 && (
        <p className="col-span-full text-xs text-muted">
          Import images or motion backgrounds in Media to use them here.
        </p>
      )}
    </div>
  );
}
