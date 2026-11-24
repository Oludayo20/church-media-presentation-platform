import { useState } from "react";
import { ClipboardPaste, Plus, Radio, Save, Trash2, X } from "lucide-react";
import { Button, cn, Input, Label } from "@cmp/design-system";
import type {
  SongData,
  SongSectionData,
  SongSectionTypeName,
} from "@cmp/shared-types";
import { SONG_LANGUAGES, SONG_SECTION_TYPES } from "@cmp/shared-validation";
import { unwrap } from "../../../lib/ipc";
import { useWorkspaceStore } from "../../../app/stores/workspace-store";
import { useLiveStore } from "../../live/live-store";
import { nextLabel, SECTION_NAMES } from "../sections";
import { sectionId, useDirty, useSongsStore } from "../songs-store";
import { ArrangementBuilder } from "./ArrangementBuilder";
import { BackgroundPicker } from "./BackgroundPicker";
import { SlidePreviewGrid } from "./SlidePreviewGrid";

export function SongEditor() {
  const {
    editing,
    change,
    save,
    remove,
    close,
    collections,
    templates,
    preview,
    previewError,
    run,
  } = useSongsStore();
  const dirty = useDirty();
  const live = useLiveStore((state) => state.live);
  const defaultSplit = useWorkspaceStore(
    (state) => state.settings?.["songs.split"],
  );
  const [pasting, setPasting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!editing) return null;
  const { data } = editing;
  const split = data.split ??
    defaultSplit ?? {
      mode: "lines" as const,
      linesPerSlide: 2,
      maxChars: 120,
      blankBetweenSections: false,
    };
  const inLive = live && live.status !== "idle" && editing.id !== null;

  const setSection = (id: string, patch: Partial<SongSectionData>) =>
    change({
      sections: data.sections.map((section) =>
        section.id === id ? { ...section, ...patch } : section,
      ),
    });
  const addSection = (type: SongSectionTypeName) => {
    const section = {
      id: sectionId(),
      type,
      label: nextLabel(type, data.sections),
      lyrics: "",
    };
    change({
      sections: [...data.sections, section],
      arrangement: [...data.arrangement, section.id],
    });
  };
  const removeSection = (id: string) =>
    change({
      sections: data.sections.filter((s) => s.id !== id),
      arrangement: data.arrangement.filter((a) => a !== id),
    });

  const text = (key: keyof SongData, value: string) =>
    change({ [key]: value.trim() === "" ? null : value } as Partial<SongData>);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6" data-testid="song-editor">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Song title"
          placeholder="Song title"
          value={data.title}
          maxLength={200}
          onChange={(event) => change({ title: event.target.value })}
          className="h-11 text-lg font-semibold"
        />
        {inLive && (
          <Button
            variant="secondary"
            title="Add this song to the running live session"
            onClick={() =>
              void run(() =>
                unwrap(window.cmp.live.queueSong({ songId: editing.id! })),
              )
            }
          >
            <Radio className="size-4" aria-hidden />
            Add to live
          </Button>
        )}
        <Button
          disabled={!dirty || !data.title.trim()}
          onClick={() => void save()}
        >
          <Save className="size-4" aria-hidden />
          Save
        </Button>
        <Button variant="ghost" aria-label="Close editor" onClick={close}>
          <X className="size-4" />
        </Button>
      </div>

      <Card title="Details">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Artist / author">
            <Input
              value={data.artist ?? ""}
              maxLength={200}
              onChange={(e) => text("artist", e.target.value)}
            />
          </Field>
          <Field label="Language">
            <select
              value={data.language}
              onChange={(e) => change({ language: e.target.value })}
              className="h-10 w-full rounded-md border border-border bg-surface px-2 text-sm"
            >
              {Object.entries(SONG_LANGUAGES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tags (comma separated)">
            <Input
              value={data.tags.join(", ")}
              onChange={(e) =>
                change({
                  tags: e.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Copyright owner">
            <Input
              value={data.copyrightOwner ?? ""}
              maxLength={200}
              onChange={(e) => text("copyrightOwner", e.target.value)}
            />
          </Field>
          <Field label="Year">
            <Input
              inputMode="numeric"
              value={data.copyrightYear ?? ""}
              onChange={(e) =>
                change({
                  copyrightYear: /^\d{4}$/.test(e.target.value)
                    ? Number(e.target.value)
                    : null,
                })
              }
            />
          </Field>
          <Field label="CCLI song number">
            <Input
              inputMode="numeric"
              value={data.ccliNumber ?? ""}
              onChange={(e) =>
                change({
                  ccliNumber: e.target.value.replace(/\D/g, "") || null,
                })
              }
            />
          </Field>
        </div>
        <div
          className="mt-3 flex flex-wrap gap-1.5"
          role="group"
          aria-label="Collections"
        >
          {collections.map((collection) => {
            const on = data.collectionIds.includes(collection.id);
            return (
              <button
                key={collection.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  change({
                    collectionIds: on
                      ? data.collectionIds.filter((id) => id !== collection.id)
                      : [...data.collectionIds, collection.id],
                  })
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs",
                  on
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border text-muted hover:text-foreground",
                )}
              >
                {collection.name}
              </button>
            );
          })}
        </div>
      </Card>

      <Card
        title="Lyrics"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPasting(true)}
          >
            <ClipboardPaste className="size-4" aria-hidden />
            Paste lyrics
          </Button>
        }
      >
        <div className="space-y-3">
          {data.sections.map((section) => (
            <div
              key={section.id}
              className="rounded-md border border-border p-3"
              data-testid="song-section"
            >
              <div className="mb-2 flex items-center gap-2">
                <select
                  aria-label="Section type"
                  value={section.type}
                  onChange={(e) =>
                    setSection(section.id, {
                      type: e.target.value as SongSectionTypeName,
                    })
                  }
                  className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {SONG_SECTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {SECTION_NAMES[type]}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Section name"
                  value={section.label}
                  maxLength={40}
                  onChange={(e) =>
                    setSection(section.id, { label: e.target.value })
                  }
                  className="h-8 max-w-48"
                />
                <button
                  type="button"
                  aria-label={`Remove ${section.label}`}
                  onClick={() => removeSection(section.id)}
                  className="ml-auto text-muted hover:text-live"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <textarea
                aria-label={`${section.label} lyrics`}
                value={section.lyrics}
                rows={Math.max(3, section.lyrics.split("\n").length + 1)}
                onChange={(e) =>
                  setSection(section.id, { lyrics: e.target.value })
                }
                className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="One line per row. A blank line starts a new stanza."
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                "verse",
                "chorus",
                "pre_chorus",
                "bridge",
                "tag",
                "intro",
                "outro",
              ] as const
            ).map((type) => (
              <Button
                key={type}
                variant="ghost"
                size="sm"
                onClick={() => addSection(type)}
              >
                <Plus className="size-3.5" aria-hidden />
                {SECTION_NAMES[type]}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Arrangement">
        <ArrangementBuilder
          sections={data.sections}
          arrangement={data.arrangement}
          onChange={(arrangement) => change({ arrangement })}
        />
      </Card>

      <Card title="Slides">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Split by">
            <select
              value={data.split ? split.mode : "default"}
              onChange={(e) =>
                change({
                  split:
                    e.target.value === "default"
                      ? null
                      : { ...split, mode: e.target.value as "lines" | "chars" },
                })
              }
              className="h-10 w-full rounded-md border border-border bg-surface px-2 text-sm"
            >
              <option value="default">Workspace default</option>
              <option value="lines">Lines</option>
              <option value="chars">Characters</option>
            </select>
          </Field>
          {split.mode === "lines" ? (
            <Field label="Lines per slide">
              <Input
                type="number"
                min={1}
                max={12}
                value={split.linesPerSlide}
                disabled={!data.split}
                onChange={(e) =>
                  change({
                    split: {
                      ...split,
                      linesPerSlide: Math.min(
                        12,
                        Math.max(1, Number(e.target.value) || 1),
                      ),
                    },
                  })
                }
              />
            </Field>
          ) : (
            <Field label="Max characters">
              <Input
                type="number"
                min={20}
                max={600}
                value={split.maxChars}
                disabled={!data.split}
                onChange={(e) =>
                  change({
                    split: {
                      ...split,
                      maxChars: Math.min(
                        600,
                        Math.max(20, Number(e.target.value) || 120),
                      ),
                    },
                  })
                }
              />
            </Field>
          )}
          <Field label="Layout">
            <select
              value={data.templateId ?? templates[0]?.id ?? ""}
              onChange={(e) => change({ templateId: e.target.value })}
              className="h-10 w-full rounded-md border border-border bg-surface px-2 text-sm"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={split.blankBetweenSections}
              disabled={!data.split}
              onChange={(e) =>
                change({
                  split: { ...split, blankBetweenSections: e.target.checked },
                })
              }
            />
            Blank slide between sections
          </label>
        </div>
        <Label className="mt-4 block text-xs text-muted">Background</Label>
        <div className="mt-1">
          <BackgroundPicker
            value={data.backgroundAssetId}
            onChange={(backgroundAssetId) => change({ backgroundAssetId })}
          />
        </div>
      </Card>

      <Card
        title={`Preview${preview ? ` · ${preview.slides.length} slides` : ""}`}
      >
        {previewError && <p className="text-sm text-live">{previewError}</p>}
        {preview ? (
          <SlidePreviewGrid doc={preview} />
        ) : (
          <p className="text-sm text-muted">
            Add a title and lyrics to see the slides.
          </p>
        )}
      </Card>

      <div className="flex justify-end">
        {confirmDelete ? (
          <div className="flex items-center gap-2 text-sm">
            Delete this song?
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button variant="live" size="sm" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-live"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" aria-hidden />
            Delete song
          </Button>
        )}
      </div>

      {pasting && <PasteDialog onClose={() => setPasting(false)} />}
    </div>
  );
}

function PasteDialog({ onClose }: { onClose(): void }) {
  const { change, run } = useSongsStore();
  const [text, setText] = useState("");
  const apply = async () => {
    const parsed = await run(() =>
      unwrap(window.cmp.songs.parseLyrics({ text })),
    );
    if (parsed) {
      change(parsed);
      onClose();
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-title"
        className="w-full max-w-2xl space-y-3 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 id="paste-title" className="font-semibold">
          Paste lyrics
        </h2>
        <p className="text-sm text-muted">
          Lines like <code>Verse 1</code>, <code>[Chorus]</code> or{" "}
          <code>V2</code> start sections; blank lines separate stanzas. A
          repeated chorus is detected. This replaces the current sections.
        </p>
        <textarea
          aria-label="Lyrics to paste"
          autoFocus
          rows={14}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-md border border-border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!text.trim()} onClick={() => void apply()}>
            Use these lyrics
          </Button>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}
