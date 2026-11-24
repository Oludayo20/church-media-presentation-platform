import { useEffect, useState } from "react";
import { Music, PencilLine, Plus } from "lucide-react";
import { Button, Input } from "@cmp/design-system";
import type { SongDetail, SongListItem } from "@cmp/shared-types";
import { errorMessage, unwrap } from "../../../lib/ipc";
import { act, useLiveStore } from "../live-store";

/**
 * Quick panel: find a song and add it to the running session (until Phase 8
 * service planning builds the playlist).
 */
export function AddSongPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SongListItem[]>([]);

  useEffect(() => {
    if (!query.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      unwrap(window.cmp.songs.list({ query: query.trim(), limit: 8 })).then(
        (songs) => live && setResults(songs),
        () => undefined,
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  const shown = query.trim() ? results : [];

  return (
    <div className="mt-4 space-y-1.5 border-t border-border pt-3">
      <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        <Music className="size-3.5" aria-hidden />
        Add song
      </h3>
      <Input
        aria-label="Find a song to add"
        placeholder="Search songs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8"
      />
      <ul aria-label="Song results">
        {shown.map((song) => (
          <li key={song.id}>
            <button
              type="button"
              onClick={() => {
                act(() => window.cmp.live.queueSong({ songId: song.id }));
                setQuery("");
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-raised"
            >
              <Plus className="size-3.5 shrink-0 text-muted" aria-hidden />
              <span className="truncate">{song.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Live lyric fix (DOCUMENTATION.md §3.6): save → main regenerates the song,
 * diffs it, and patches only the changed slides on the projector.
 */
export function EditLyricsButton({ songId }: { songId: string }) {
  const [song, setSong] = useState<SongDetail | null>(null);

  const open = async () => {
    try {
      setSong(await unwrap(window.cmp.songs.get({ id: songId })));
    } catch (error) {
      useLiveStore.setState({ error: errorMessage(error) });
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => void open()}>
        <PencilLine className="size-4" aria-hidden />
        Edit lyrics
      </Button>
      {song && <LyricsDialog song={song} onClose={() => setSong(null)} />}
    </>
  );
}

function LyricsDialog({
  song,
  onClose,
}: {
  song: SongDetail;
  onClose(): void;
}) {
  const [sections, setSections] = useState(song.sections);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { id, createdAt: _c, updatedAt: _u, ...data } = song;
    try {
      await unwrap(
        window.cmp.songs.update({ id, song: { ...data, sections } }),
      );
      onClose();
    } catch (error) {
      useLiveStore.setState({ error: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lyrics-title"
        className="max-h-full w-full max-w-xl space-y-3 overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 id="lyrics-title" className="font-semibold">
          Fix lyrics · {song.title}
        </h2>
        <p className="text-xs text-muted">
          Changes go straight to the screen: only the edited slides change, and
          any video keeps playing.
        </p>
        {sections.map((section) => (
          <label key={section.id} className="block space-y-1">
            <span className="text-xs font-medium">{section.label}</span>
            <textarea
              aria-label={`${section.label} lyrics`}
              value={section.lyrics}
              rows={Math.max(2, section.lyrics.split("\n").length)}
              onChange={(e) =>
                setSections(
                  sections.map((s) =>
                    s.id === section.id ? { ...s, lyrics: e.target.value } : s,
                  ),
                )
              }
              className="w-full rounded-md border border-border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            Save to screen
          </Button>
        </div>
      </div>
    </div>
  );
}
