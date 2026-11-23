import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../client";
import {
  appliedMigrations,
  migrate,
  MigrationError,
  splitStatements,
  WorkspaceTooNewError,
  type Migration,
} from "../migrate";
import { migrations } from "../migrations.generated";

const v1: Migration = {
  tag: "0000_a",
  sql: "CREATE TABLE a (id TEXT PRIMARY KEY);--> statement-breakpoint\nINSERT INTO a VALUES ('x');",
};
const v2: Migration = { tag: "0001_b", sql: "CREATE TABLE b (id TEXT);" };
const broken: Migration = {
  tag: "0001_broken",
  sql: "CREATE TABLE c (id TEXT);--> statement-breakpoint\nTHIS IS NOT SQL;",
};

const tables = (database: Database) =>
  database.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row["name"]);

let open: Database[] = [];
const memory = () => {
  const database = openDatabase({ path: ":memory:" });
  open.push(database);
  return database;
};
afterEach(() => {
  open.forEach((database) => database.close());
  open = [];
});

describe("splitStatements", () => {
  it("splits on drizzle-kit breakpoints and drops blanks", () => {
    expect(splitStatements("A;--> statement-breakpoint\n B; \n")).toEqual([
      "A;",
      "B;",
    ]);
  });
});

describe("migrate", () => {
  it("applies everything to a fresh database without a backup", async () => {
    const database = memory();
    const beforeMigrate = vi.fn();
    const result = await migrate(database.sqlite, [v1, v2], { beforeMigrate });
    expect(result.applied).toEqual(["0000_a", "0001_b"]);
    expect(appliedMigrations(database.sqlite)).toEqual(["0000_a", "0001_b"]);
    expect(beforeMigrate).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing is pending", async () => {
    const database = memory();
    await migrate(database.sqlite, [v1]);
    const beforeMigrate = vi.fn();
    expect(
      await migrate(database.sqlite, [v1], { beforeMigrate }),
    ).toEqual({ applied: [] });
    expect(beforeMigrate).not.toHaveBeenCalled();
  });

  it("runs the pre-migration backup hook before upgrading an existing db", async () => {
    const database = memory();
    await migrate(database.sqlite, [v1]);
    const beforeMigrate = vi.fn(() => {
      // The hook sees the database before any pending migration ran.
      expect(tables(database)).not.toContain("b");
    });
    await migrate(database.sqlite, [v1, v2], { beforeMigrate });
    expect(beforeMigrate).toHaveBeenCalledWith({
      applied: ["0000_a"],
      pending: ["0001_b"],
    });
    expect(tables(database)).toContain("b");
  });

  it("does not migrate when the backup hook fails", async () => {
    const database = memory();
    await migrate(database.sqlite, [v1]);
    await expect(
      migrate(database.sqlite, [v1, v2], {
        beforeMigrate: () => {
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("disk full");
    expect(appliedMigrations(database.sqlite)).toEqual(["0000_a"]);
  });

  it("rolls back every pending migration when one fails", async () => {
    const database = memory();
    await migrate(database.sqlite, [v1]);
    await expect(
      migrate(database.sqlite, [v1, v2, { ...broken, tag: "0002_broken" }]),
    ).rejects.toBeInstanceOf(MigrationError);
    expect(appliedMigrations(database.sqlite)).toEqual(["0000_a"]);
    expect(tables(database)).not.toContain("b");
    expect(tables(database)).not.toContain("c");
    // foreign keys are switched back on afterwards
    expect(
      database.sqlite.prepare("PRAGMA foreign_keys").get()?.["foreign_keys"],
    ).toBe(1);
  });

  it("refuses a workspace written by a newer app version", async () => {
    const database = memory();
    await migrate(database.sqlite, [v1, v2]);
    await expect(migrate(database.sqlite, [v1])).rejects.toBeInstanceOf(
      WorkspaceTooNewError,
    );
  });
});

describe("real schema migrations", () => {
  it("apply cleanly to an in-memory database", async () => {
    const database = memory();
    await migrate(database.sqlite, migrations);
    expect(tables(database)).toEqual([
      "app_migrations",
      "church_members",
      "churches",
      "media_assets",
      "media_folders",
      "presentations",
      "settings",
      "slide_objects",
      "slides",
      "users",
    ]);
  });

  it("are embedded in sync with packages/database/migrations", () => {
    const dir = join(__dirname, "../../migrations");
    const onDisk = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => ({
        tag: file.replace(/\.sql$/, ""),
        sql: readFileSync(join(dir, file), "utf8"),
      }));
    expect(migrations).toEqual(onDisk);
  });
});

describe("file database", () => {
  it("opens in WAL mode with the §9.1 pragmas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmp-db-"));
    try {
      const database = openDatabase({ path: join(dir, "workspace.db") });
      const pragma = (name: string) =>
        Object.values(database.sqlite.prepare(`PRAGMA ${name}`).get() ?? {})[0];
      expect(pragma("journal_mode")).toBe("wal");
      expect(pragma("foreign_keys")).toBe(1);
      expect(pragma("synchronous")).toBe(1); // NORMAL
      expect(pragma("busy_timeout")).toBe(5000);
      database.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
