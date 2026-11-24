/**
 * @cmp/database — Drizzle schema, migrations and repositories over the local
 * SQLite workspace (`node:sqlite`). Only the Electron main process may import
 * this package (enforced by dependency-cruiser).
 * See docs/DOCUMENTATION.md §9 and §12.
 */
export * as schema from "./schema";
export {
  MEMBER_ROLES,
  MEDIA_TYPES,
  type MemberRole,
  type MediaType,
} from "./schema";
export {
  applyPragmas,
  openDatabase,
  type Database,
  type Db,
  type OpenDatabaseOptions,
} from "./client";
export {
  appliedMigrations,
  migrate,
  MigrationError,
  splitStatements,
  WorkspaceTooNewError,
  type MigrateOptions,
  type MigrateResult,
  type Migration,
  type PendingMigrationInfo,
} from "./migrate";
export { migrations } from "./migrations.generated";
export { isUlid, newId, nowIso } from "./ids";
export {
  createWorkspaceRepository,
  type Church,
  type CreateWorkspaceInput,
  type WorkspaceRepository,
} from "./repositories/workspace-repository";
export {
  createMediaRepository,
  type CreateMediaAssetInput,
  type MediaAsset,
  type MediaRepository,
} from "./repositories/media-repository";
export {
  createSettingsRepository,
  type SettingDefinition,
  type SettingsCatalog,
  type SettingsRepository,
  type SettingsRepositoryOptions,
  type SettingsValues,
} from "./repositories/settings-repository";
export {
  createDisplayProfileRepository,
  type DisplayProfile,
  type DisplayProfileRepository,
  type RememberDisplayInput,
} from "./repositories/display-profile-repository";
export {
  createLiveSessionRepository,
  type LiveSessionRecord,
  type LiveSessionRepository,
  type LiveSessionSnapshot,
} from "./repositories/live-session-repository";
export {
  createMediaLibraryRepository,
  type LibraryAsset,
  type LibraryFilter,
  type LibraryPatch,
  type LicenceType,
  type MediaFolder,
  type MediaLibraryRepository,
  type MediaLicence,
  type MediaUsage,
} from "./repositories/media-library-repository";
export { LICENCE_TYPES } from "./schema";
export {
  createSongRepository,
  toFtsQuery,
  type SongInput,
  type SongRecord,
  type SongRepository,
  type SongSearch,
  type SongSectionInput,
  type SongSectionType,
  type SongSplit,
  type SongSummary,
} from "./repositories/song-repository";
export { SONG_SECTION_TYPES } from "./schema";
export { createBibleRepository } from "./repositories/bible-repository";
export { createPresentationRepository } from "./repositories/presentation-repository";
export {
  createServiceRepository,
  type ServiceDraft,
  type ServiceFields,
  type ServiceGroupRecord,
  type ServiceItemRecord,
  type ServiceItemType,
  type ServiceRecord,
  type ServiceRepository,
  type ServiceSummary,
} from "./repositories/service-repository";
export { SERVICE_ITEM_TYPES } from "./schema";
