import { useState } from "react";
import {
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Type,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@cmp/design-system";
import type { MediaItem } from "@cmp/shared-types";
import { mediaUrl } from "../../../lib/media";

const ICONS: Record<MediaItem["mediaType"], LucideIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
  font: Type,
};

export function thumbUrl(item: MediaItem): string | null {
  if (item.hasThumbnail) return `cmp-media://thumb/${item.id}`;
  if (item.mediaType === "image") return mediaUrl(item.id);
  return null;
}

/**
 * The thumbnail/poster, and for videos a muted hover preview (DOCUMENTATION
 * §7 "hover-preview"). Missing files show a placeholder, never a broken icon.
 */
export function MediaThumb({
  item,
  className,
  hoverPreview = true,
}: {
  item: MediaItem;
  className?: string;
  hoverPreview?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = thumbUrl(item);
  const Icon = ICONS[item.mediaType];
  const preview =
    hoverPreview && hovered && item.mediaType === "video" && !item.isMissing;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-black/40",
        className,
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {src && !failed && !item.isMissing ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <Icon className="size-8 text-muted" aria-hidden />
      )}
      {preview && (
        <video
          data-testid="hover-preview"
          src={mediaUrl(item.id)}
          muted
          autoPlay
          loop
          playsInline
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </div>
  );
}
