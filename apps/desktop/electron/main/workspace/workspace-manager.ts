import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { backup } from "node:sqlite";
import {
  createBibleRepository,
  createPresentationRepository,
  createDisplayProfileRepository,
  createLiveSessionRepository,
  createMediaLibraryRepository,
  createServiceRepository,
  createSongRepository,
  createMediaRepository,
  createSettingsRepository,
  createWorkspaceRepository,
  migrate,
  migrations as bundledMigrations,
  newId,
  openDatabase,
  type Database,
  type DisplayProfileRepository,
  type LiveSessionRepository,
  type MediaLibraryRepository,
  type ServiceRepository,
  type SongRepository,
  type MediaRepository,
  type Migration,
  type SettingsRepository,
  type WorkspaceRepository,
} from "@cmp/database";
import { AppError, type WorkspaceState } from "@cmp/shared-types";
import { settingsCatalog } from "@cmp/shared-validation";
import type { ConfigStore } from "../config/config-store";
import type { Logger } from "../logging/logger";

export interface OpenWorkspace {
  id: string;
  dir: string;
  mediaDir: string;
  thumbsDir: string;
  database: Database;
  churches: WorkspaceRepository;
  media: MediaRepository;
  settings: SettingsRepository<typeof settingsCatalog>;
  displayProfiles: DisplayProfileRepository;
  liveSessions: LiveSessionRepository;
  library: MediaLibraryRepository;
  songs: SongRepository;
  services: ServiceRepository;
  bible: ReturnType<typeof createBibleRepository>;
  presentations: ReturnType<typeof createPresentationRepository>;
}

export interface WorkspaceManagerOptions {
  workspacesDir: string;
  backupsDir: string;
  appVersion: string;
  config: ConfigStore;
  logger: Logger;
  /** Overridable in tests. */
  migrations?: readonly Migration[];
}

/** Folders inside `workspaces/<churchId>/` (DOCUMENTATION.md §13). */
const WORKSPACE_SUBDIRS = ["media", "thumbs", "fonts"] as const;
const OWNER_DISPLAY_NAME = "Workspace owner";

/**
 * Owns the one open workspace: `workspaces/<churchId>/workspace.db` plus its
 * media folders. Opening runs pending migrations, taking a pre-migration
 * backup of an existing database first (DOCUMENTATION.md §9.2).
 */
export function createWorkspaceManager(options: WorkspaceManagerOptions) {
  const migrations = options.migrations ?? bundledMigrations;
  const { logger, config } = options;
  let current: OpenWorkspace | null = null;
  /** Set when a pre-migration backup is written; shown if migration fails. */
  let lastBackupPath: string | null = null;

  async function openAt(id: string): Promise<OpenWorkspace> {
    const dir = join(options.workspacesDir, id);
    await Promise.all(
      WORKSPACE_SUBDIRS.map((sub) =>
        mkdir(join(dir, sub), { recursive: true }),
      ),
    );
    const database = openDatabase({ path: join(dir, "workspace.db") });
    try {
      const result = await migrate(database.sqlite, migrations, {
        beforeMigrate: async ({ pending }) => {
          lastBackupPath = await backupBeforeMigrate(database, pending);
        },
      });
      if (result.applied.length > 0) {
        logger.info(`[workspace] ${id}: applied ${result.applied.join(", ")}`);
      }
    } catch (error) {
      database.close();
      throw error;
    }
    return {
      id,
      dir,
      mediaDir: join(dir, "media"),
      thumbsDir: join(dir, "thumbs"),
      database,
      churches: createWorkspaceRepository(database),
      media: createMediaRepository(database),
      displayProfiles: createDisplayProfileRepository(database, id),
      liveSessions: createLiveSessionRepository(database, id),
      library: createMediaLibraryRepository(database, id),
      bible: createBibleRepository(database),
      presentations: createPresentationRepository(database, id),
      songs: createSongRepository(database, id),
      services: createServiceRepository(database, id),
      settings: createSettingsRepository(database, id, settingsCatalog, {
        onInvalid: (key, error) =>
          logger.warn(
            `[settings] stored ${key} is invalid; using default`,
            error,
          ),
      }),
    };
  }

  async function backupBeforeMigrate(
    database: Database,
    pending: readonly string[],
  ): Promise<string> {
    await mkdir(options.backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // A db-only snapshot via SQLite's online backup API. Phase 9 wraps it
    // in the `.cmpbackup` zip format.
    const target = join(
      options.backupsDir,
      `pre-migrate-${options.appVersion}-${stamp}.db`,
    );
    await backup(database.sqlite, target);
    logger.info(
      `[workspace] backed up before migrating ${pending.join(", ")} → ${target}`,
    );
    return target;
  }

  return {
    current: () => current,

    get lastBackupPath() {
      return lastBackupPath;
    },

    /** Throws `NOT_FOUND` when no workspace exists yet (pre-onboarding). */
    require(): OpenWorkspace {
      if (!current) throw new AppError("NOT_FOUND", "No workspace is open");
      return current;
    },

    /** Opens the workspace recorded in config.json, if it still exists. */
    async openActive(): Promise<OpenWorkspace | null> {
      const id = config.get().activeWorkspaceId;
      if (!id) return null;
      if (!existsSync(join(options.workspacesDir, id, "workspace.db"))) {
        logger.warn(`[workspace] ${id} is missing on disk; starting fresh`);
        config.update({ activeWorkspaceId: undefined });
        return null;
      }
      current = await openAt(id);
      return current;
    },

    /** Onboarding step 1: creates the workspace, church and owner. */
    async create(churchName: string): Promise<OpenWorkspace> {
      if (current) throw new AppError("CONFLICT", "A workspace already exists");
      const id = newId();
      const workspace = await openAt(id);
      try {
        await workspace.churches.createWithOwner({
          churchId: id,
          churchName,
          ownerDisplayName: OWNER_DISPLAY_NAME,
        });
        config.update({ activeWorkspaceId: id });
      } catch (error) {
        workspace.database.close();
        await rm(workspace.dir, { recursive: true, force: true });
        throw error;
      }
      current = workspace;
      logger.info(`[workspace] created ${id}`);
      return workspace;
    },

    async state(): Promise<WorkspaceState> {
      if (!current) return { status: "none" };
      const church = await current.churches.getChurch(current.id);
      if (!church) return { status: "none" };
      const completedAt = await current.settings.get("onboarding.completedAt");
      return {
        status: completedAt ? "ready" : "onboarding",
        workspace: {
          id: church.id,
          churchName: church.name,
          logoAssetId: church.logoAssetId,
        },
      };
    },

    close(): void {
      current?.database.close();
      current = null;
    },
  };
}

export type WorkspaceManager = ReturnType<typeof createWorkspaceManager>;
