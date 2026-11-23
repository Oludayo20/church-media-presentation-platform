import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

/**
 * Driver choice: Node's built-in `node:sqlite` (SQLite 3.5x with FTS5), not
 * better-sqlite3. It is present in both Electron's Node and the Node that runs
 * Vitest, so there is no native module to rebuild per Electron ABI, no
 * prebuilt binary download and no install script (docs/ARCHITECTURE.md §2.5).
 *
 * Drizzle has no stable `node:sqlite` driver yet, so we drive it through
 * `drizzle-orm/sqlite-proxy`: Drizzle builds the SQL, and the callback below
 * executes it synchronously. Promises resolve immediately, so queries never
 * yield to another IPC call mid-flight.
 */
export type Db = SqliteRemoteDatabase<typeof schema>;

export interface Database {
  /** Drizzle query builder bound to this connection. */
  readonly db: Db;
  /** The underlying connection, for pragmas, migrations and backups. */
  readonly sqlite: DatabaseSync;
  /**
   * Runs `work` in `BEGIN IMMEDIATE … COMMIT`, rolling back on throw.
   * Transactions are serialised on this connection. Do not await real I/O
   * (files, dialogs, network) inside `work`: only database calls.
   */
  transaction<T>(work: (db: Db) => Promise<T>): Promise<T>;
  close(): void;
}

export interface OpenDatabaseOptions {
  /** Use `":memory:"` in tests. */
  path: string;
  readOnly?: boolean;
}

/** DOCUMENTATION.md §9.1. WAL is skipped for in-memory databases. */
export function applyPragmas(sqlite: DatabaseSync, inMemory: boolean): void {
  if (!inMemory) sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
}

export function openDatabase(options: OpenDatabaseOptions): Database {
  const inMemory = options.path === ":memory:";
  const sqlite = new DatabaseSync(options.path, {
    readOnly: options.readOnly ?? false,
  });
  applyPragmas(sqlite, inMemory);

  const db = drizzle(
    async (sql, params, method) => {
      const statement = sqlite.prepare(sql);
      const args = params as SQLInputValue[];
      if (method === "run") {
        statement.run(...args);
        return { rows: [] };
      }
      // Drizzle's proxy driver maps positional rows onto the schema fields.
      statement.setReturnArrays(true);
      if (method === "get") {
        return { rows: (statement.get(...args) ?? undefined) as never };
      }
      return { rows: statement.all(...args) };
    },
    { schema },
  );

  let queue: Promise<unknown> = Promise.resolve();

  return {
    db,
    sqlite,
    transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = await work(db);
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          if (sqlite.isTransaction) sqlite.exec("ROLLBACK");
          throw error;
        }
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
    close() {
      if (sqlite.isOpen) sqlite.close();
    },
  };
}
