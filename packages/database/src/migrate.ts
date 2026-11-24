import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  /** drizzle-kit tag, e.g. `0000_init`. Stored in `app_migrations.version`. */
  tag: string;
  /** SQL with drizzle-kit `--> statement-breakpoint` separators. */
  sql: string;
}

export interface PendingMigrationInfo {
  applied: readonly string[];
  pending: readonly string[];
}

export interface MigrateOptions {
  /**
   * Called before pending migrations are applied to a database that already
   * has migrations, i.e. an existing workspace being upgraded. The desktop
   * app takes the pre-migration backup here (DOCUMENTATION.md §9.2). If it
   * throws, nothing is migrated. Not called for a brand-new database.
   */
  beforeMigrate?: (info: PendingMigrationInfo) => void | Promise<void>;
  now?: () => Date;
}

export interface MigrateResult {
  applied: string[];
}

/** The workspace was written by a newer app version: refuse to touch it. */
export class WorkspaceTooNewError extends Error {
  constructor(readonly unknownVersions: string[]) {
    super(
      `Workspace has migrations this app does not know: ${unknownVersions.join(", ")}`,
    );
    this.name = "WorkspaceTooNewError";
  }
}

export class MigrationError extends Error {
  constructor(
    readonly version: string,
    options: { cause: unknown },
  ) {
    super(
      `Migration ${version} failed; the workspace was rolled back`,
      options,
    );
    this.name = "MigrationError";
  }
}

const BREAKPOINT = "--> statement-breakpoint";

export function splitStatements(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export function appliedMigrations(sqlite: DatabaseSync): string[] {
  ensureMigrationsTable(sqlite);
  return sqlite
    .prepare("SELECT version FROM app_migrations ORDER BY version")
    .all()
    .map((row) => String(row["version"]));
}

/**
 * Applies pending migrations in a single transaction
 * (DOCUMENTATION.md §9.2):
 *
 * 1. read `app_migrations`;
 * 2. if the database already has migrations and some are pending, run the
 *    `beforeMigrate` hook (pre-migration backup);
 * 3. apply every pending migration inside one transaction, with foreign keys
 *    off so table rebuilds work, then `PRAGMA foreign_key_check`;
 * 4. on any failure, roll back and throw `MigrationError`.
 */
export async function migrate(
  sqlite: DatabaseSync,
  migrations: readonly Migration[],
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const now = options.now ?? (() => new Date());
  const applied = appliedMigrations(sqlite);
  const known = new Set(migrations.map((migration) => migration.tag));
  const unknown = applied.filter((version) => !known.has(version));
  if (unknown.length > 0) throw new WorkspaceTooNewError(unknown);

  const done = new Set(applied);
  const pending = migrations.filter((migration) => !done.has(migration.tag));
  if (pending.length === 0) return { applied: [] };

  if (applied.length > 0 && options.beforeMigrate) {
    await options.beforeMigrate({
      applied,
      pending: pending.map((migration) => migration.tag),
    });
  }

  // foreign_keys cannot change inside a transaction, so turn it off first.
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec("BEGIN IMMEDIATE");
  let current = "";
  try {
    const record = sqlite.prepare(
      "INSERT INTO app_migrations (version, applied_at) VALUES (?, ?)",
    );
    for (const migration of pending) {
      current = migration.tag;
      for (const statement of splitStatements(migration.sql)) {
        sqlite.exec(statement);
      }
      record.run(migration.tag, now().toISOString());
    }
    current = "foreign_key_check";
    const violations = sqlite.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(
        `Foreign key violations after migrating: ${JSON.stringify(violations)}`,
      );
    }
    sqlite.exec("COMMIT");
  } catch (cause) {
    if (sqlite.isTransaction) sqlite.exec("ROLLBACK");
    throw new MigrationError(current, { cause });
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }

  return { applied: pending.map((migration) => migration.tag) };
}

function ensureMigrationsTable(sqlite: DatabaseSync): void {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS app_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
}
