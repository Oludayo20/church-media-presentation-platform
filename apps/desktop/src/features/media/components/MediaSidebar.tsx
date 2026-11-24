import { useState } from "react";
import {
  CircleAlert,
  Folder,
  FolderPlus,
  Layers,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { cn } from "@cmp/design-system";
import type { MediaTypeName } from "@cmp/shared-types";
import { unwrap } from "../../../lib/ipc";
import { useMediaStore, type MediaFilter } from "../media-store";

const TYPES: { type: MediaTypeName; label: string }[] = [
  { type: "image", label: "Images" },
  { type: "video", label: "Videos" },
  { type: "audio", label: "Audio" },
  { type: "document", label: "Documents" },
  { type: "font", label: "Fonts" },
];

export function MediaSidebar() {
  const { filter, folders, tags, setFilter, resetFilter, run, refreshMeta } =
    useMediaStore();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const isView = (patch: Partial<MediaFilter>) =>
    Object.entries(patch).every(
      ([key, value]) => filter[key as keyof MediaFilter] === value,
    );

  const createFolder = async () => {
    const trimmed = name.trim();
    setNaming(false);
    setName("");
    if (!trimmed) return;
    await run(() => unwrap(window.cmp.media.createFolder({ name: trimmed })));
    await refreshMeta();
  };

  return (
    <aside
      aria-label="Library filters"
      className="w-56 shrink-0 space-y-5 overflow-y-auto border-r border-border bg-surface p-3 text-sm"
    >
      <Group>
        <Item
          icon={Layers}
          label="All media"
          active={isView({
            folderId: "all",
            favourite: false,
            missing: false,
            mediaType: null,
            tag: null,
          })}
          onClick={resetFilter}
        />
        <Item
          icon={Star}
          label="Favourites"
          active={filter.favourite}
          onClick={() => setFilter({ favourite: !filter.favourite })}
        />
        <Item
          icon={CircleAlert}
          label="Missing files"
          active={filter.missing}
          onClick={() => setFilter({ missing: !filter.missing })}
        />
      </Group>

      <Group title="Type">
        {TYPES.map(({ type, label }) => (
          <Item
            key={type}
            label={label}
            active={filter.mediaType === type}
            onClick={() =>
              setFilter({ mediaType: filter.mediaType === type ? null : type })
            }
          />
        ))}
      </Group>

      <Group
        title="Folders"
        action={
          <button
            type="button"
            aria-label="New folder"
            onClick={() => setNaming(true)}
            className="text-muted hover:text-foreground"
          >
            <FolderPlus className="size-4" />
          </button>
        }
      >
        <Item
          icon={Folder}
          label="Unfiled"
          active={filter.folderId === null}
          onClick={() =>
            setFilter({ folderId: filter.folderId === null ? "all" : null })
          }
        />
        {folders.map((folder) => (
          <div key={folder.id} className="group flex items-center">
            <Item
              icon={Folder}
              label={folder.name}
              count={folder.assetCount}
              active={filter.folderId === folder.id}
              onClick={() =>
                setFilter({
                  folderId: filter.folderId === folder.id ? "all" : folder.id,
                })
              }
            />
            <button
              type="button"
              aria-label={`Delete folder ${folder.name}`}
              title="Delete folder (its media moves to Unfiled)"
              onClick={async () => {
                await run(() =>
                  unwrap(window.cmp.media.deleteFolder({ id: folder.id })),
                );
                if (filter.folderId === folder.id)
                  setFilter({ folderId: "all" });
                await refreshMeta();
              }}
              className="ml-1 rounded p-1 text-muted opacity-0 hover:text-live focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {naming && (
          <input
            autoFocus
            aria-label="Folder name"
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void createFolder()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createFolder();
              if (event.key === "Escape") setNaming(false);
            }}
            className="w-full rounded border border-border bg-background px-2 py-1"
            placeholder="Folder name"
          />
        )}
      </Group>

      {tags.length > 0 && (
        <Group title="Tags">
          {tags.map((tag) => (
            <Item
              key={tag.name}
              icon={Tag}
              label={tag.name}
              count={tag.count}
              active={filter.tag === tag.name}
              onClick={() =>
                setFilter({ tag: filter.tag === tag.name ? null : tag.name })
              }
            />
          ))}
        </Group>
      )}
    </aside>
  );
}

function Group({
  title,
  action,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      {title && (
        <div className="flex items-center justify-between px-2 pb-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {title}
          </h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Item({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left",
        active
          ? "bg-primary/15 font-medium text-foreground"
          : "text-muted hover:bg-surface-raised hover:text-foreground",
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      <span className="truncate">{label}</span>
      {count !== undefined && <span className="ml-auto text-xs">{count}</span>}
    </button>
  );
}
