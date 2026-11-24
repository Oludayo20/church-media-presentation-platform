import { useEffect, useRef, useState } from "react";
import { LayoutGrid, List, Search, ScanSearch, Upload } from "lucide-react";
import { Button, cn, Input } from "@cmp/design-system";
import { unwrap } from "../../lib/ipc";
import { ImportTray } from "./components/ImportTray";
import { MediaDetailPanel } from "./components/MediaDetailPanel";
import { MediaGrid } from "./components/MediaGrid";
import { MediaSidebar } from "./components/MediaSidebar";
import { useMediaStore } from "./media-store";

/**
 * The Media Library (DOCUMENTATION.md §7): everything is imported into the
 * workspace and works offline. Drop files anywhere on the page to import.
 */
export function MediaPage() {
  const {
    connect,
    items,
    loading,
    nextCursor,
    loadMore,
    filter,
    setFilter,
    view,
    setView,
    detail,
    importPaths,
    run,
    error,
    dismissError,
  } = useMediaStore();
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState(filter.query);
  const depth = useRef(0);

  useEffect(() => connect(), [connect]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query !== useMediaStore.getState().filter.query) setFilter({ query });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, setFilter]);

  const hasFiles = (event: React.DragEvent) =>
    event.dataTransfer.types.includes("Files");

  return (
    <div className="flex h-full">
      <MediaSidebar />
      <section
        aria-label="Library"
        className="relative flex min-w-0 flex-1 flex-col"
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          depth.current += 1;
          setDragging(true);
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDragOver={(event) => {
          if (hasFiles(event)) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          const paths = [...event.dataTransfer.files]
            .map((file) => window.cmp.files.pathFor(file))
            .filter(Boolean);
          void importPaths(paths);
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative max-w-sm flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              aria-label="Search media"
              placeholder="Search media"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-8"
            />
          </div>
          <div
            role="group"
            aria-label="View"
            className="ml-auto inline-flex rounded-md border border-border p-0.5"
          >
            {(
              [
                ["grid", LayoutGrid],
                ["list", List],
              ] as const
            ).map(([mode, Icon]) => (
              <button
                key={mode}
                type="button"
                aria-label={`${mode} view`}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className={cn(
                  "rounded p-1.5",
                  view === mode
                    ? "bg-surface-raised text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            title="Check every file is still on disk"
            onClick={() =>
              void run(() => unwrap(window.cmp.media.scanMissing()))
            }
          >
            <ScanSearch className="size-4" aria-hidden />
            Check files
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void run(() =>
                unwrap(
                  window.cmp.media.chooseAndImport(
                    filter.folderId === "all"
                      ? {}
                      : { folderId: filter.folderId },
                  ),
                ),
              )
            }
          >
            <Upload className="size-4" aria-hidden />
            Import
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 bg-live/10 px-4 py-2 text-sm text-live"
          >
            {error}
            <button
              type="button"
              className="ml-auto text-xs underline"
              onClick={dismissError}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 && !loading ? (
            <EmptyState
              filtered={
                filter.query !== "" ||
                filter.folderId !== "all" ||
                filter.mediaType !== null ||
                filter.tag !== null ||
                filter.favourite ||
                filter.missing
              }
            />
          ) : (
            <MediaGrid items={items} />
          )}
          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                disabled={loading}
                onClick={() => void loadMore()}
              >
                Load more
              </Button>
            </div>
          )}
        </div>

        <ImportTray />
        {dragging && (
          <div
            data-testid="drop-zone"
            className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10"
          >
            <p className="text-lg font-medium">
              Drop to import into the library
            </p>
          </div>
        )}
      </section>
      {detail && <MediaDetailPanel detail={detail} />}
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
      <Upload className="size-8" aria-hidden />
      <p className="text-base font-medium text-foreground">
        {filtered ? "Nothing matches" : "Your library is empty"}
      </p>
      <p className="max-w-sm text-sm">
        {filtered
          ? "Try another search or filter."
          : "Drag images, videos, audio, PDFs, PowerPoint files or fonts here, or use Import. Everything is stored on this computer and works offline."}
      </p>
    </div>
  );
}
