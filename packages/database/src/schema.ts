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
    check(
      "church_members_role_ck",
      sql`${t.role} IN (${inList(MEMBER_ROLES)})`,
    ),
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
    /** Relative to the workspace `thumbs` directory. */
    thumbnailPath: text("thumbnail_path"),
    hasAudio: integer("has_audio", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Offer conversion to H.264 MP4: `unsupported-codec` | `large-gif`. */
    transcodeReason: text("transcode_reason"),
    /** Plays only with hardware support: `hevc`. */
    playbackWarning: text("playback_warning"),
    /** Fonts: the family name read from the font's `name` table. */
    fontFamily: text("font_family"),
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

export const mediaTags = sqliteTable(
  "media_tags",
  {
    id: text("id").primaryKey(),
    churchId: text("church_id")
      .notNull()
      .references(() => churches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("media_tags_church_name_uq").on(t.churchId, t.name)],
);

export const mediaAssetTags = sqliteTable(
  "media_asset_tags",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => mediaTags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.tagId] }),
    index("media_asset_tags_tag_idx").on(t.tagId),
  ],
);

export const LICENCE_TYPES = [
  "owned",
  "licensed",
  "public_domain",
  "creative_commons",
  "unknown",
] as const;

/** Where an asset came from and what we may do with it (§14 licensing). */
export const mediaLicences = sqliteTable(
  "media_licences",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    licenceType: text("licence_type", { enum: LICENCE_TYPES }).notNull(),
    source: text("source"),
    attribution: text("attribution"),
    terms: text("terms"),
  },
  (t) => [uniqueIndex("media_licences_asset_uq").on(t.assetId)],
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

// ── Displays & live sessions (Phases 2–3) ────────────────────────────────────

export const DISPLAY_ROLES = ["main", "stage", "foyer", "stream"] as const;

/**
 * A remembered audience display (DOCUMENTATION.md §4.1). The fingerprint is
 * `sha256(label|width|height|scaleFactor)`, so the same projector is
 * recognised when it is plugged back in, even if the OS gives it a new id.
 * `width`/`height` are the output resolution chosen for it.
 */
export const displayProfiles = sqliteTable(
  "display_profiles",
  {
    id: text("id").primaryKey(),
    churchId: text("church_id")
      .notNull()
      .references(() => churches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fingerprint: text("fingerprint").notNull(),
    role: text("role", { enum: DISPLAY_ROLES }).notNull().default("main"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    lastUsedAt: text("last_used_at"),
  },
  (t) => [
    uniqueIndex("display_profiles_church_fingerprint_uq").on(
      t.churchId,
      t.fingerprint,
    ),
  ],
);

/**
 * The live session journal (DOCUMENTATION.md §9.4): written while a service
 * runs (debounced 250 ms, flushed on item change) so a crash can resume at
 * the same item and slide. `service_id` gains its foreign key when the
 * services table arrives in Phase 8.
 */
export const liveSessions = sqliteTable(
  "live_sessions",
  {
    id: text("id").primaryKey(),
    churchId: text("church_id").notNull(),
    serviceId: text("service_id"),
    displayProfileId: text("display_profile_id"),
    currentItemId: text("current_item_id"),
    currentSlideIndex: integer("current_slide_index").notNull().default(0),
    overlayStackJson: text("overlay_stack_json", { mode: "json" })
      .notNull()
      .default(sql`'[]'`),
    playbackStateJson: text("playback_state_json", { mode: "json" }),
    startedAt: text("started_at").notNull(),
    heartbeatAt: text("heartbeat_at").notNull(),
    endedAt: text("ended_at"),
  },
  (t) => [index("live_sessions_ended_at_idx").on(t.endedAt)],
);

export type DisplayProfileRow = typeof displayProfiles.$inferSelect;
export type LiveSessionRow = typeof liveSessions.$inferSelect;

// ── Songs (Phase 5) ──────────────────────────────────────────────────────────

export const SONG_SECTION_TYPES = [
  "intro",
  "verse",
  "pre_chorus",
  "chorus",
  "bridge",
  "refrain",
  "tag",
  "outro",
] as const;

/**
 * DOCUMENTATION.md §12. Additions to the DDL: `tags_json` (song tags, also
 * indexed in `songs_fts`), `split_json` (per-song split override) and
 * `template_id` holds a built-in lyric layout until Phase 7 templates.
 * `songs_fts` is created by the custom migration `0004_songs_fts`.
 */
export const songs = sqliteTable(
  "songs",
  {
    id: text("id").primaryKey(),
    churchId: text("church_id")
      .notNull()
      .references(() => churches.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    artist: text("artist"),
    language: text("language").notNull().default("en"),
    category: text("category"),
    copyrightOwner: text("copyright_owner"),
    copyrightYear: integer("copyright_year"),
    ccliNumber: text("ccli_number"),
    licenceReference: text("licence_reference"),
    defaultBackgroundAssetId: text("default_background_asset_id").references(
      () => mediaAssets.id,
      {
        onDelete: "set null",
      },
    ),
    defaultTemplateId: text("default_template_id"),
    tagsJson: text("tags_json", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    /** Starred in the Song Manager; shown on Home (Phase 8). */
    isFavourite: integer("is_favourite", { mode: "boolean" }).notNull().default(false),
    splitJson: text("split_json", { mode: "json" }),
    archivedAt: text("archived_at"),
    ...timestamps,
  },
  (t) => [index("songs_church_title_idx").on(t.churchId, t.title)],
);

export const songSections = sqliteTable(
  "song_sections",
  {
    id: text("id").primaryKey(),
    songId: text("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
    sectionType: text("section_type", { enum: SONG_SECTION_TYPES }).notNull(),
    label: text("label").notNull(),
    sectionOrder: integer("section_order").notNull(),
    lyrics: text("lyrics").notNull(),
  },
  (t) => [index("song_sections_song_idx").on(t.songId, t.sectionOrder)],
);

export const songArrangements = sqliteTable(
  "song_arrangements",
  {
    id: text("id").primaryKey(),
    songId: text("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sectionIdsJson: text("section_ids_json", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [index("song_arrangements_song_idx").on(t.songId)],
);

export const songCollections = sqliteTable(
  "song_collections",
  {
    id: text("id").primaryKey(),
    churchId: text("church_id")
      .notNull()
      .references(() => churches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("song_collections_church_name_uq").on(t.churchId, t.name),
  ],
);

export const songCollectionItems = sqliteTable(
  "song_collection_items",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => songCollections.id, { onDelete: "cascade" }),
    songId: text("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.songId] }),
    index("song_collection_items_song_idx").on(t.songId),
  ],
);

export type SongRow = typeof songs.$inferSelect;

export const bibleTranslations = sqliteTable("bible_translations", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  language: text("language").notNull(),
  licence: text("licence").notNull(),
  attribution: text("attribution").notNull(),
  versification: text("versification").notNull(),
  checksum: text("checksum").notNull(),
});

export const bibleBooks = sqliteTable(
  "bible_books",
  {
    id: integer("id").primaryKey(),
    translationCode: text("translation_code")
      .notNull()
      .references(() => bibleTranslations.code, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    uniqueIndex("bible_books_position_uq").on(t.translationCode, t.position),
  ],
);

export const bibleBookAliases = sqliteTable(
  "bible_book_aliases",
  {
    bookId: integer("book_id")
      .notNull()
      .references(() => bibleBooks.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.alias] })],
);

export const bibleVerses = sqliteTable(
  "bible_verses",
  {
    id: integer("id").primaryKey(),
    bookId: integer("book_id")
      .notNull()
      .references(() => bibleBooks.id, { onDelete: "cascade" }),
    chapter: integer("chapter").notNull(),
    verse: integer("verse").notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    uniqueIndex("bible_verses_reference_uq").on(t.bookId, t.chapter, t.verse),
  ],
);

export const scriptureCollections = sqliteTable("scripture_collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const scripturePassages = sqliteTable(
  "scripture_passages",
  {
    id: text("id").primaryKey(),
    translationCode: text("translation_code")
      .notNull()
      .references(() => bibleTranslations.code, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    collectionId: text("collection_id").references(
      () => scriptureCollections.id,
      { onDelete: "cascade" },
    ),
  },
  (t) => [
    uniqueIndex("scripture_passages_reference_uq").on(
      t.translationCode,
      t.reference,
      t.collectionId,
    ),
  ],
);

export const presentationVersions = sqliteTable(
  "presentation_versions",
  {
    id: text("id").primaryKey(),
    presentationId: text("presentation_id")
      .notNull()
      .references(() => presentations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshotJson: text("snapshot_json", { mode: "json" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("presentation_versions_number_uq").on(
      t.presentationId,
      t.version,
    ),
  ],
);

export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    churchId: text("church_id")
      .notNull()
      .references(() => churches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    document: text("document_json", { mode: "json" }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("templates_church_name_uq").on(t.churchId, t.name)],
);


// ── Services (Phase 8) ───────────────────────────────────────────────────────

export const SERVICE_STATUSES = ["draft", "ready", "live", "completed", "archived"] as const;

export const SERVICE_ITEM_TYPES = [
  "presentation",
  "song",
  "scripture",
  "video",
  "image",
  "countdown",
  "announcement",
  "blank",
  "camera_placeholder",
] as const;

export const services = sqliteTable(
  "services",
  {
    id: text("id").primaryKey(),
    churchId: text("church_id")
      .notNull()
      .references(() => churches.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    serviceType: text("service_type"),
    /** `YYYY-MM-DD`. */
    serviceDate: text("service_date"),
    /** `HH:MM`, local time. */
    startTime: text("start_time"),
    theme: text("theme"),
    description: text("description"),
    assignedUserId: text("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status", { enum: SERVICE_STATUSES }).notNull().default("draft"),
    ...timestamps,
  },
  (t) => [
    index("services_church_date_idx").on(t.churchId, t.serviceDate),
    check("services_status_ck", sql`${t.status} IN (${inList(SERVICE_STATUSES)})`),
  ],
);

export const serviceItemGroups = sqliteTable(
  "service_item_groups",
  {
    id: text("id").primaryKey(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("service_item_groups_service_idx").on(t.serviceId, t.position)],
);

/**
 * Polymorphic service items (DOCUMENTATION.md §8.1). `ref_id` points at a
 * presentation, song or media asset depending on `item_type`; SQLite cannot
 * enforce that, so the repository checks it on write. `label` names a
 * template placeholder ("Opening song") until content is chosen.
 */
export const serviceItems = sqliteTable(
  "service_items",
  {
    id: text("id").primaryKey(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    groupId: text("group_id").references(() => serviceItemGroups.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    itemType: text("item_type", { enum: SERVICE_ITEM_TYPES }).notNull(),
    refId: text("ref_id"),
    optionsJson: text("options_json", { mode: "json" }).notNull(),
    label: text("label"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("service_items_service_idx").on(t.serviceId, t.position),
    index("service_items_ref_idx").on(t.refId),
    check("service_items_type_ck", sql`${t.itemType} IN (${inList(SERVICE_ITEM_TYPES)})`),
  ],
);

/** Church-made templates; the built-in ones live in code. */
export const serviceTemplates = sqliteTable("service_templates", {
  id: text("id").primaryKey(),
  churchId: text("church_id")
    .notNull()
    .references(() => churches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  definitionJson: text("definition_json", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull(),
});
