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
