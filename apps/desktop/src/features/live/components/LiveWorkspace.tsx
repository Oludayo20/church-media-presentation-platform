import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Image as ImageIcon,
  Layers,
  Megaphone,
  Monitor,
  MonitorOff,
  Music,
  Pause,
  Play,
  Presentation,
  Square,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { Button, cn } from "@cmp/design-system";
import type {
  DisplayStatus,
  LiveState,
  PlaylistItemKind,
} from "@cmp/shared-types";
import type { EngineDocument } from "@cmp/shared-validation";
import { unwrap } from "../../../lib/ipc";
import { BiblePage } from "../../bible/BiblePage";
import { act, useDocument, useLiveStore } from "../live-store";
import { useLiveShortcuts } from "../useLiveShortcuts";
import { SlidePreviewGrid } from "../../songs/components/SlidePreviewGrid";
import { AddSongPanel, EditLyricsButton } from "./SongQuickPanels";
import { AudienceMirror, SlidePreview } from "./EngineViews";

const KIND_ICONS: Record<PlaylistItemKind, LucideIcon> = {
  announcement: Megaphone,
  song: Music,
  scripture: BookOpen,
  media: ImageIcon,
  presentation: Presentation,
};

export function LiveWorkspace({
  live,
  displays,
}: {
  live: LiveState;
  displays: DisplayStatus;
}) {
  const loadDocument = useLiveStore((state) => state.loadDocument);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [quickScripture, setQuickScripture] = useState(false);
  const [overlayPreview, setOverlayPreview] = useState<{
    key: string;
    doc: EngineDocument;
  }>();
  const quickDialog = useRef<HTMLDialogElement>(null);
  const overlay = live.overlay;
  const overlayKey =
    overlay?.itemIndex === -1
      ? JSON.stringify([live.sessionId, overlay.title, overlay.depth])
      : null;

  useEffect(() => {
    if (!overlayKey) return;
    let current = true;
    void unwrap(window.cmp.live.overlayDocument())
      .then((doc) => {
        if (current && doc) setOverlayPreview({ key: overlayKey, doc });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [overlayKey]);

  useEffect(() => {
    const dialog = quickDialog.current;
    if (!quickScripture || !dialog) return;
    dialog.showModal();
    dialog.querySelector("input")?.focus();
  }, [quickScripture]);
  const currentItemIndex = overlay ? overlay.itemIndex : live.itemIndex;
  const currentSlide = overlay ? overlay.slideIndex : live.slideIndex;
  const playlistDoc = useDocument(currentItemIndex);
  const scriptureDoc =
    overlayKey && overlayPreview?.key === overlayKey
      ? overlayPreview.doc
      : null;
  const currentDoc = overlayKey ? scriptureDoc : playlistDoc;
  const nextTarget = nextSlide(live);
  const nextItemIndex = nextTarget?.itemIndex ?? null;
  const nextPlaylistDoc = useDocument(nextItemIndex);
  const nextDoc = nextItemIndex === -1 ? scriptureDoc : nextPlaylistDoc;
  const sessionId = live.sessionId;

  useEffect(() => {
    if (!sessionId) return;
    if (currentItemIndex >= 0) void loadDocument(currentItemIndex);
    if (nextItemIndex !== null && nextItemIndex >= 0)
      void loadDocument(nextItemIndex);
  }, [loadDocument, currentItemIndex, nextItemIndex, sessionId]);

  useLiveShortcuts(live, {
    onRequestEnd: () => setConfirmEnd(true),
    onQuickScripture: () => setQuickScripture(true),
  });

  return (
    <div className="flex h-full flex-col">
      <TopBar
        live={live}
        displays={displays}
        onEnd={() => setConfirmEnd(true)}
      />
      {live.output === "disconnected" && <DisconnectedBanner />}

      <div className="flex min-h-0 flex-1">
        <Playlist live={live} />

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              title={
                live.output === "display"
                  ? "Audience output"
                  : "Output (preview only)"
              }
            >
              <AudienceMirror />
            </Panel>
            <Panel
              title={
                overlay ? `Current · overlay: ${overlay.title}` : "Current"
              }
            >
              <SlidePreview
                doc={currentDoc}
                slideIndex={currentSlide}
                label="Current slide"
              />
            </Panel>
          </div>
          <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
            <Panel title="Next">
              <SlidePreview
                doc={nextDoc}
                slideIndex={nextTarget?.slideIndex ?? -1}
                label="Next slide"
              />
            </Panel>
            <div className="space-y-3">
              <Button
                variant="secondary"
                onClick={() => setQuickScripture(true)}
              >
                Quick Scripture
              </Button>
              {live.video && <TransportBar video={live.video} />}
              {live.warnings.length > 0 && (
                <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                  {live.warnings.at(-1)!.message}: the fallback background is
                  showing.
                </p>
              )}
              <p className="text-xs text-muted">
                → / Page Down next · ← / Page Up previous · ↑ ↓ items · B black
                · L logo · C clear · type a number then Enter to jump · Esc{" "}
                {overlay ? "closes the overlay" : "ends"}
              </p>
            </div>
          </div>
          <ThumbnailStrip doc={currentDoc} current={currentSlide} />
        </div>
      </div>

      {quickScripture && (
        <dialog
          ref={quickDialog}
          aria-label="Quick Scripture"
          onCancel={(event) => event.preventDefault()}
          className="m-auto max-h-[90vh] w-[min(50rem,95vw)] rounded-lg border border-border bg-surface text-foreground backdrop:bg-black/60"
        >
          <BiblePage
            quick
            onReturn={() => {
              quickDialog.current?.close();
              setQuickScripture(false);
            }}
          />
        </dialog>
      )}
      {confirmEnd && (
        <ConfirmDialog
          title="End the live presentation?"
          body="The audience screen goes black and the session is closed."
          confirm="End"
          onCancel={() => setConfirmEnd(false)}
          onConfirm={() => {
            setConfirmEnd(false);
            act(() => window.cmp.live.end());
          }}
        />
      )}
    </div>
  );
}

function nextSlide(
  live: LiveState,
): { itemIndex: number; slideIndex: number } | null {
  if (live.overlay) {
    return live.overlay.slideIndex + 1 < live.overlay.slideCount
      ? {
          itemIndex: live.overlay.itemIndex,
          slideIndex: live.overlay.slideIndex + 1,
        }
      : null;
  }
  const item = live.items[live.itemIndex];
  if (item && live.slideIndex + 1 < item.slideCount) {
    return { itemIndex: live.itemIndex, slideIndex: live.slideIndex + 1 };
  }
  return live.itemIndex + 1 < live.items.length
    ? { itemIndex: live.itemIndex + 1, slideIndex: 0 }
    : null;
}

const STATUS_LABEL: Record<LiveState["status"], string> = {
  idle: "Idle",
  preparing: "Preparing…",
  live: "Live",
  masked: "Masked",
  overlay: "Overlay",
  suspended: "Output paused",
};

function TopBar({
  live,
  displays,
  onEnd,
}: {
  live: LiveState;
  displays: DisplayStatus;
  onEnd(): void;
}) {
  const audience = displays.audience;
  const item = live.items[live.itemIndex];
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
      <span
        data-testid="live-status"
        data-status={live.status}
        className={cn(
          "rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
          live.status === "suspended"
            ? "bg-live text-live-foreground"
            : live.status === "live" || live.status === "overlay"
              ? "bg-live/15 text-live"
              : "bg-surface-raised text-muted",
        )}
      >
        {live.mask === "black"
          ? "Black"
          : live.mask === "logo"
            ? "Logo"
            : STATUS_LABEL[live.status]}
      </span>
      <span
        data-testid="display-chip"
        data-connected={live.output === "display"}
        className="inline-flex items-center gap-1.5 text-sm text-muted"
      >
        {live.output === "display" ? (
          <Monitor className="size-4 text-success" aria-hidden />
        ) : (
          <MonitorOff
            className={cn(
              "size-4",
              live.output === "disconnected" && "text-live",
            )}
            aria-hidden
          />
        )}
        {live.output === "preview"
          ? "Preview only"
          : (audience?.name ?? "No display")}
      </span>
      <span data-testid="live-position" className="text-sm text-muted">
        {item
          ? `${item.title} · ${live.slideIndex + 1}/${item.slideCount}`
          : ""}
      </span>
      {item?.songId && <EditLyricsButton songId={item.songId} />}

      <div
        className="ml-auto flex items-center gap-2"
        role="group"
        aria-label="Output controls"
      >
        <Toggle
          label="Black"
          on={live.mask === "black"}
          onClick={() =>
            act(() => window.cmp.live.blank({ on: live.mask !== "black" }))
          }
        />
        <Toggle
          label="Logo"
          on={live.mask === "logo"}
          onClick={() =>
            act(() => window.cmp.live.logo({ on: live.mask !== "logo" }))
          }
        />
        <Toggle
          label="Clear"
          on={live.cleared}
          onClick={() =>
            act(() => window.cmp.live.clear({ on: !live.cleared }))
          }
        />
        <Button variant="ghost" size="sm" onClick={onEnd}>
          End
        </Button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-9 min-w-20 rounded-md border px-3 text-sm font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on
          ? "border-live bg-live text-live-foreground"
          : "border-border bg-surface-raised text-foreground hover:bg-surface",
      )}
    >
      {label}
    </button>
  );
}

function DisconnectedBanner() {
  return (
    <div
      role="alert"
      data-testid="disconnected-banner"
      className="flex items-center gap-3 bg-live px-4 py-2 text-sm font-medium text-live-foreground"
    >
      <MonitorOff className="size-4" aria-hidden />
      Projector disconnected. Output paused. Plug it back in to resume where you
      left off.
      <button
        type="button"
        className="ml-auto rounded border border-live-foreground/50 px-2 py-0.5 text-xs hover:bg-live-foreground/10"
        onClick={() => act(() => window.cmp.live.continueInPreview())}
      >
        Continue in preview
      </button>
    </div>
  );
}

function Playlist({ live }: { live: LiveState }) {
  return (
    <nav
      aria-label="Playlist"
      className="w-64 shrink-0 overflow-y-auto border-r border-border bg-surface p-2"
    >
      <ul className="space-y-0.5">
        {live.items.map((item, index) => {
          const Icon = KIND_ICONS[item.kind];
          const active = index === live.itemIndex;
          return (
            <li key={item.id} className="group flex items-center">
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() =>
                  act(() => window.cmp.live.itemGoto({ itemIndex: index }))
                }
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                  active
                    ? "bg-primary/15 font-medium"
                    : "text-muted hover:bg-surface-raised hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("size-4 shrink-0", active && "text-primary")}
                  aria-hidden
                />
                <span className="truncate">{item.title}</span>
                <span className="ml-auto text-xs text-muted">
                  {item.slideCount}
                </span>
              </button>
              <button
                type="button"
                title={`Show “${item.title}” as an overlay`}
                aria-label={`Overlay ${item.title}`}
                onClick={() =>
                  act(() => window.cmp.live.overlayPush({ itemIndex: index }))
                }
                className="ml-1 rounded p-1.5 text-muted opacity-0 hover:bg-surface-raised hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Layers className="size-4" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {live.overlay && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          onClick={() => act(() => window.cmp.live.overlayPop())}
        >
          Close overlay (Esc)
        </Button>
      )}
      <AddSongPanel />
    </nav>
  );
}

/** Slides of the current item, grouped by section ("Chorus") for one-click jumps. */
function ThumbnailStrip({
  doc,
  current,
}: {
  doc: ReturnType<typeof useDocument>;
  current: number;
}) {
  if (!doc) return null;
  return (
    <section aria-label="Slides" className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
        Slides
      </h2>
      <SlidePreviewGrid
        doc={doc}
        current={current}
        onSelect={(index) =>
          act(() => window.cmp.live.goto({ slideIndex: index }))
        }
      />
    </section>
  );
}

function TransportBar({ video }: { video: NonNullable<LiveState["video"]> }) {
  const duration = video.durationMs ?? 0;
  return (
    <div
      data-transport=""
      data-testid="transport"
      className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={video.paused ? "Play" : "Pause"}
        onClick={() => act(() => window.cmp.live.video({ action: "toggle" }))}
      >
        {video.paused ? (
          <Play className="size-4" />
        ) : (
          <Pause className="size-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Stop"
        onClick={() => act(() => window.cmp.live.video({ action: "stop" }))}
      >
        <Square className="size-4" />
      </Button>
      <span className="w-24 text-xs tabular-nums text-muted">
        {clock(video.timeMs)} / {duration ? clock(duration) : "--:--"}
      </span>
      <input
        type="range"
        aria-label="Seek"
        className="flex-1 accent-primary"
        min={0}
        max={duration || 1}
        value={Math.min(video.timeMs, duration || 1)}
        onChange={(event) =>
          act(() =>
            window.cmp.live.video({
              action: "seek",
              value: Number(event.target.value),
            }),
          )
        }
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label={video.muted ? "Unmute" : "Mute"}
        onClick={() =>
          act(() =>
            window.cmp.live.video({
              action: "mute",
              value: video.muted ? 0 : 1,
            }),
          )
        }
      >
        {video.muted ? (
          <VolumeX className="size-4" />
        ) : (
          <Volume2 className="size-4" />
        )}
      </Button>
      <input
        type="range"
        aria-label="Volume"
        className="w-24 accent-primary"
        min={0}
        max={1}
        step={0.05}
        value={video.volume}
        onChange={(event) =>
          act(() =>
            window.cmp.live.video({
              action: "volume",
              value: Number(event.target.value),
            }),
          )
        }
      />
    </div>
  );
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 id="confirm-title" className="font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="live" onClick={onConfirm}>
            {confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
