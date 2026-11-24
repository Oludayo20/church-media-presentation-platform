import { useState, type FormEvent } from "react";
import { CircleAlert, RefreshCw, Trash2, X } from "lucide-react";
import { Button, Input, Label } from "@cmp/design-system";
import {
  LICENCE_TYPE_NAMES,
  type MediaDetail,
  type MediaLicenceInfo,
} from "@cmp/shared-types";
import { MEDIA_CATEGORIES, type MediaCategory } from "@cmp/shared-validation";
import { unwrap } from "../../../lib/ipc";
import { mediaUrl } from "../../../lib/media";
import { formatBytes, formatDuration } from "../format";
import { useMediaStore } from "../media-store";

const LICENCE_LABELS: Record<MediaLicenceInfo["licenceType"], string> = {
  owned: "We own it",
  licensed: "Licensed",
  public_domain: "Public domain",
  creative_commons: "Creative Commons",
  unknown: "Unknown",
};

export function MediaDetailPanel({ detail }: { detail: MediaDetail }) {
  const { select, run, reload, refreshMeta, folders, blockedBy } =
    useMediaStore();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = async (
    patch: Parameters<typeof window.cmp.media.update>[0]["patch"],
  ) => {
    await run(() => unwrap(window.cmp.media.update({ id: detail.id, patch })));
    await Promise.all([reload(), refreshMeta(), select(detail.id)]);
  };

  return (
    <aside
      aria-label="Media details"
      data-testid="media-detail"
      className="w-80 shrink-0 space-y-5 overflow-y-auto border-l border-border bg-surface p-4 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="break-all font-semibold">{detail.name}</h2>
        <button
          type="button"
          aria-label="Close details"
          onClick={() => void select(null)}
          className="text-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <Preview detail={detail} />

      {detail.isMissing && (
        <Notice tone="live">
          The file is missing from the media folder. Slides that use it show the
          fallback background.
        </Notice>
      )}
      {detail.transcodeReason && (
        <Notice tone="warning">
          {detail.transcodeReason === "large-gif"
            ? "Large GIFs stutter. Convert it to a looping MP4 for smooth playback."
            : "This video uses a format the projector may not play. Convert it to H.264 MP4."}
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() =>
              void run(() =>
                unwrap(window.cmp.media.transcode({ id: detail.id })),
              )
            }
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Convert to MP4
          </Button>
        </Notice>
      )}
      {detail.playbackWarning === "hevc" && (
        <Notice tone="warning">
          HEVC plays only where the computer has hardware support. Test it on
          the service laptop.
        </Notice>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Size</dt>
        <dd>{formatBytes(detail.fileSize)}</dd>
        {detail.width && (
          <>
            <dt className="text-muted">Dimensions</dt>
            <dd>
              {detail.width} × {detail.height}
            </dd>
          </>
        )}
        {detail.durationMs !== null && (
          <>
            <dt className="text-muted">Length</dt>
            <dd>{formatDuration(detail.durationMs)}</dd>
          </>
        )}
        {detail.codec && (
          <>
            <dt className="text-muted">Codec</dt>
            <dd>
              {detail.codec}
              {detail.mediaType === "video" &&
                (detail.hasAudio ? " · with sound" : " · silent")}
            </dd>
          </>
        )}
        <dt className="text-muted">Original</dt>
        <dd className="break-all">{detail.originalName ?? "—"}</dd>
      </dl>

      <RenameField
        key={detail.name}
        detail={detail}
        onSave={(name) => update({ name })}
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-xs text-muted">Category</span>
          <select
            value={detail.category ?? ""}
            onChange={(event) =>
              void update({
                category: (event.target.value || null) as MediaCategory | null,
              })
            }
            className="h-9 w-full rounded-md border border-border bg-background px-2"
          >
            <option value="">None</option>
            {Object.entries(MEDIA_CATEGORIES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Folder</span>
          <select
            value={detail.folderId ?? ""}
            onChange={(event) =>
              void update({ folderId: event.target.value || null })
            }
            className="h-9 w-full rounded-md border border-border bg-background px-2"
          >
            <option value="">Unfiled</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <TagsField key={detail.tags.join("|")} detail={detail} />
      <LicenceForm key={JSON.stringify(detail.licence)} detail={detail} />

      {detail.usedBy.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Used by
          </h3>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {detail.usedBy.map((use) => (
              <li key={`${use.type}:${use.id}`}>{use.title}</li>
            ))}
          </ul>
        </div>
      )}

      {blockedBy && (
        <Notice tone="live">
          <span role="alert">
            Can’t delete: still used by{" "}
            {blockedBy.map((use) => use.title).join(", ")}.
          </span>
        </Notice>
      )}

      {confirmDelete ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs">
            Delete this file from the library?
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="live"
            onClick={async () => {
              setConfirmDelete(false);
              const result = await run(() =>
                unwrap(window.cmp.media.delete({ id: detail.id })),
              );
              if (result) await select(null);
            }}
          >
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
          Delete
        </Button>
      )}
    </aside>
  );
}

function Preview({ detail }: { detail: MediaDetail }) {
  if (detail.isMissing) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-md bg-black/40 text-muted">
        <CircleAlert className="size-6" aria-hidden />
      </div>
    );
  }
  if (detail.mediaType === "image") {
    return (
      <img
        src={mediaUrl(detail.id)}
        alt=""
        className="aspect-video w-full rounded-md bg-black object-contain"
      />
    );
  }
  if (detail.mediaType === "video") {
    return (
      <video
        src={mediaUrl(detail.id)}
        controls
        muted
        className="aspect-video w-full rounded-md bg-black"
      />
    );
  }
  if (detail.mediaType === "audio")
    return <audio src={mediaUrl(detail.id)} controls className="w-full" />;
  return null;
}

function Notice({
  tone,
  children,
}: {
  tone: "live" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        tone === "live"
          ? "rounded-md bg-live/10 p-3 text-xs text-live"
          : "rounded-md bg-warning/10 p-3 text-xs text-warning"
      }
    >
      {children}
    </div>
  );
}

function RenameField({
  detail,
  onSave,
}: {
  detail: MediaDetail;
  onSave(name: string): Promise<void>;
}) {
  const [name, setName] = useState(detail.name);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && name.trim() !== detail.name) void onSave(name.trim());
  };
  return (
    <form onSubmit={submit} className="space-y-1">
      <Label htmlFor="media-name" className="text-xs text-muted">
        Name
      </Label>
      <Input
        id="media-name"
        value={name}
        maxLength={200}
        onChange={(event) => setName(event.target.value)}
        onBlur={submit}
      />
    </form>
  );
}

function TagsField({ detail }: { detail: MediaDetail }) {
  const { run, reload, refreshMeta, select } = useMediaStore();
  const [value, setValue] = useState(detail.tags.join(", "));
  const save = async () => {
    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.join("|") === detail.tags.join("|")) return;
    await run(() => unwrap(window.cmp.media.setTags({ id: detail.id, tags })));
    await Promise.all([reload(), refreshMeta(), select(detail.id)]);
  };
  return (
    <div className="space-y-1">
      <Label htmlFor="media-tags" className="text-xs text-muted">
        Tags (comma separated)
      </Label>
      <Input
        id="media-tags"
        value={value}
        placeholder="easter, worship"
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => event.key === "Enter" && void save()}
      />
    </div>
  );
}

function LicenceForm({ detail }: { detail: MediaDetail }) {
  const { run, select } = useMediaStore();
  const [licence, setLicence] = useState<MediaLicenceInfo>(
    detail.licence ?? {
      licenceType: "unknown",
      source: null,
      attribution: null,
      terms: null,
    },
  );
  const save = async (next: MediaLicenceInfo) => {
    setLicence(next);
    await run(() =>
      unwrap(window.cmp.media.setLicence({ id: detail.id, licence: next })),
    );
    await select(detail.id);
  };
  const text = (key: "source" | "attribution", label: string) => (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      <Input
        value={licence[key] ?? ""}
        maxLength={500}
        onChange={(event) =>
          setLicence({ ...licence, [key]: event.target.value || null })
        }
        onBlur={() => void save(licence)}
      />
    </label>
  );
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
        Licence
      </legend>
      <select
        aria-label="Licence type"
        value={licence.licenceType}
        onChange={(event) =>
          void save({
            ...licence,
            licenceType: event.target.value as MediaLicenceInfo["licenceType"],
          })
        }
        className="h-9 w-full rounded-md border border-border bg-background px-2"
      >
        {LICENCE_TYPE_NAMES.map((type) => (
          <option key={type} value={type}>
            {LICENCE_LABELS[type]}
          </option>
        ))}
      </select>
      {text("source", "Source")}
      {text("attribution", "Attribution")}
    </fieldset>
  );
}
