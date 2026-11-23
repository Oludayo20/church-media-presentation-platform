/**
 * Drizzle schema for the local workspace database (docs/DOCUMENTATION.md §12).
 *
 * Phase 1 covers the workspace (churches, users, members), settings, and
 * presentations → slides → slide_objects. `media_folders`/`media_assets` are
 * pulled forward from Phase 4 because onboarding stores the church logo as a
 * media asset and `cmp-media://` needs something to resolve.
 *
 * Conventions: ULID `TEXT` ids, ISO-8601 UTC `TEXT` timestamps, JSON in
 * `*_json` TEXT columns. `app_migrations` is owned by the migration runner
 * (src/migrate.ts), not by this schema.
 *
 * Deviation from the §12 DDL: SQLite cannot make a UNIQUE constraint
 * DEFERRABLE, so `slides(presentation_id, position)` is a plain unique index
 * and reorders must write positions in two passes.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const MEMBER_ROLES = [
  "owner",
  "media_admin",
  "media_operator",
  "content_editor",
  "viewer",
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEDIA_TYPES = [
  "image",
  "video",
  "audio",
  "document",
  "font",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const BACKGROUND_TYPES = [
  "color",
  "gradient",
  "image",
  "video",
  "transparent",
] as const;

export const SLIDE_OBJECT_TYPES = [
  "text",
  "image",
  "video",
  "shape",
  "bible",
  "countdown",
] as const;

const inList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(","));

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

// ── Workspace ────────────────────────────────────────────────────────────────

export const churches = sqliteTable("churches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  logoAssetId: text("logo_asset_id"),
  defaultLanguage: text("default_language").default("en"),
  defaultTranslationId: text("default_translation_id"),
  ...timestamps,
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  /** Optional local PIN (argon2id). No passwords in the MVP. */
  pinHash: text("pin_hash"),
  createdAt: text("created_at").notNull(),
});

export const churchMembers = sqliteTable(
  "church_members",
  {
    id: text("id").primaryKey(),
    churchId: text("church_id")
      .notNull()
      .references(() => churches.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: MEMBER_ROLES })
      .notNull()
      .default("media_operator"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("church_members_church_user_uq").on(t.churchId, t.userId),
    check("church_members_role_ck", sql`${t.role} IN (${inList(MEMBER_ROLES)})`),
  ],
);

/**
 * Typed key/value settings (catalogue: DOCUMENTATION.md §13). One database
 * holds one workspace, so `church_id` is effectively constant; it is NOT NULL
 * because SQLite treats NULLs in a composite primary key as distinct.
 */
export const settings = sqliteTable(
  "settings",
  {
    churchId: text("church_id").notNull(),
    key: text("key").notNull(),
    valueJson: text("value_json").notNull(),
  },
  (t) => [primaryKey({ columns: [t.churchId, t.key] })],
);

// ── Media (pulled forward from Phase 4: logo + cmp-media://) ────────────────

export const mediaFolders = sqliteTable("media_folders", {
  id: text("id").primaryKey(),
  churchId: text("church_id")
    .notNull()
    .references(() => churches.id, { onDelete: "cascade" }),
  parentId: text("parent_id").references(
    (): AnySQLiteColumn => mediaFolders.id,
    { onDelete: "cascade" },
  ),
  name: text("name").notNull(),
});

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    churchId: text("church_id")
      .notNull()
      .references(() => churches.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => mediaFolders.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    originalName: text("original_name"),
    mediaType: text("media_type", { enum: MEDIA_TYPES }).notNull(),
    /** motion_background, gospel_video, flyer, logo, … */
    category: text("category"),
    mimeType: text("mime_type"),
    /** Relative to the workspace media directory. Never absolute. */
    filePath: text("file_path").notNull(),
    fileSize: integer("file_size").notNull().default(0),
    checksum: text("checksum").notNull(),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    codec: text("codec"),
    thumbnailPath: text("thumbnail_path"),
    isFavourite: integer("is_favourite", { mode: "boolean" })
      .notNull()
      .default(false),
    isMissing: integer("is_missing", { mode: "boolean" })
      .notNull()
      .default(false),
    archivedAt: text("archived_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("media_assets_church_checksum_uq").on(t.churchId, t.checksum),
    index("media_assets_church_category_idx").on(t.churchId, t.category),
    index("media_assets_checksum_idx").on(t.checksum),
    check(
      "media_assets_media_type_ck",
      sql`${t.mediaType} IN (${inList(MEDIA_TYPES)})`,
    ),
  ],
);

// ── Presentations ────────────────────────────────────────────────────────────

export const presentations = sqliteTable("presentations", {
  id: text("id").primaryKey(),
  churchId: text("church_id")
    .notNull()
    .references(() => churches.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  width: integer("width").notNull().default(1920),
  height: integer("height").notNull().default(1080),
  schemaVersion: text("schema_version")
    .notNull()
    .default("cmp.presentation/v1"),
  isFavourite: integer("is_favourite", { mode: "boolean" })
    .notNull()
    .default(false),
  archivedAt: text("archived_at"),
  ...timestamps,
});

export const slides = sqliteTable(
  "slides",
  {
    id: text("id").primaryKey(),
    presentationId: text("presentation_id")
      .notNull()
      .references(() => presentations.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    slideType: text("slide_type").notNull(),
    backgroundType: text("background_type", { enum: BACKGROUND_TYPES })
      .notNull()
      .default("color"),
    /** Colour, gradient JSON or asset id, depending on `background_type`. */
    backgroundValue: text("background_value"),
    /** loop, mute, blur, overlay. */
    backgroundOptionsJson: text("background_options_json", { mode: "json" }),
    transitionType: text("transition_type").notNull().default("cut"),
    transitionMs: integer("transition_ms").notNull().default(0),
    durationMs: integer("duration_ms"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("slides_presentation_position_uq").on(
      t.presentationId,
      t.position,
    ),
    check(
      "slides_background_type_ck",
      sql`${t.backgroundType} IN (${inList(BACKGROUND_TYPES)})`,
    ),
  ],
);

export const slideObjects = sqliteTable(
  "slide_objects",
  {
    id: text("id").primaryKey(),
    slideId: text("slide_id")
      .notNull()
      .references(() => slides.id, { onDelete: "cascade" }),
    objectType: text("object_type", { enum: SLIDE_OBJECT_TYPES }).notNull(),
    zIndex: integer("z_index").notNull().default(0),
    propertiesJson: text("properties_json", { mode: "json" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("slide_objects_slide_idx").on(t.slideId, t.zIndex),
    check(
      "slide_objects_object_type_ck",
      sql`${t.objectType} IN (${inList(SLIDE_OBJECT_TYPES)})`,
    ),
  ],
);

export type ChurchRow = typeof churches.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type NewMediaAssetRow = typeof mediaAssets.$inferInsert;
