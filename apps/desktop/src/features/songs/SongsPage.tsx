import { useEffect, useState } from "react";
import { FileUp, Music, Plus, Search } from "lucide-react";
import { Button, cn, Input } from "@cmp/design-system";
import { SongEditor } from "./components/SongEditor";
import { useSongsStore } from "./songs-store";

/** The Song Manager (DOCUMENTATION.md §5). */
export function SongsPage() {
  const {
    init,
    songs,
    query,
    collectionId,
    collections,
    search,
    open,
    startNew,
    editing,
    importSongs,
    error,
    notice,
    dismiss,
  } = useSongsStore();
  const [text, setText] = useState(query);

  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text !== useSongsStore.getState().query) void search({ query: text });
    }, 150);
    return () => clearTimeout(timer);
  }, [text, search]);

  return (
    <div className="flex h-full">
      <aside
        aria-label="Songs"
        className="flex w-80 shrink-0 flex-col border-r border-border bg-surface"
      >
        <div className="space-y-2 p-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              aria-label="Search songs"
              placeholder="Search titles and lyrics"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="pl-8"
            />
          </div>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Collections filter"
          >
            {[{ id: null, name: "All" }, ...collections].map((collection) => (
              <button
                key={collection.id ?? "all"}
                type="button"
                aria-pressed={collectionId === collection.id}
                onClick={() => void search({ collectionId: collection.id })}
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  collectionId === collection.id
                    ? "bg-primary/20 text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {collection.name}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={startNew}>
              <Plus className="size-4" aria-hidden />
              New song
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={() => void importSongs()}
            >
              <FileUp className="size-4" aria-hidden />
              Import…
            </Button>
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto px-2 pb-2" aria-label="Song list">
          {songs.map((song) => (
            <li key={song.id}>
              <button
                type="button"
                data-testid="song-item"
                aria-current={editing?.id === song.id ? "true" : undefined}
                onClick={() => void open(song.id)}
                className={cn(
                  "w-full rounded-md px-2.5 py-2 text-left",
                  editing?.id === song.id
                    ? "bg-primary/15"
                    : "hover:bg-surface-raised",
                )}
              >
                <p className="truncate text-sm font-medium">{song.title}</p>
                <p className="truncate text-xs text-muted">
                  {[song.artist, `${song.sectionCount} sections`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {song.snippet && (
                  <p
                    className="mt-0.5 line-clamp-2 text-xs text-muted"
                    data-testid="song-snippet"
                  >
                    {song.snippet}
                  </p>
                )}
              </button>
            </li>
          ))}
          {songs.length === 0 && (
            <li className="p-3 text-sm text-muted">
              {query ? "No songs match." : "No songs yet."}
            </li>
          )}
        </ul>
      </aside>

      <main
        className="relative min-w-0 flex-1 overflow-y-auto"
        aria-label="Song editor"
      >
        {(error || notice) && (
          <div
            role={error ? "alert" : "status"}
            className={cn(
              "sticky top-0 z-10 flex items-center gap-2 px-4 py-2 text-sm",
              error ? "bg-live/10 text-live" : "bg-success/10 text-success",
            )}
          >
            {error ?? notice}
            <button
              type="button"
              className="ml-auto text-xs underline"
              onClick={dismiss}
            >
              Dismiss
            </button>
          </div>
        )}
        {editing ? (
          <SongEditor key={editing.id ?? "new"} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
            <Music className="size-8" aria-hidden />
            <p className="text-base font-medium text-foreground">
              Choose a song or create one
            </p>
            <p className="max-w-sm text-sm">
              Paste lyrics, or import plain text, OpenLyrics and CCLI SongSelect
              files.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
