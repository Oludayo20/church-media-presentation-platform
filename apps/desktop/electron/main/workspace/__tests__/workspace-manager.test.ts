import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MigrationError, migrations, type Migration } from "@cmp/database";
import { createConfigStore } from "../../config/config-store";
import { silentLogger } from "../../logging/logger";
import { createWorkspaceManager } from "../workspace-manager";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cmp-ws-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function manager(extraMigrations: Migration[] = []) {
  return createWorkspaceManager({
    workspacesDir: join(root, "workspaces"),
    backupsDir: join(root, "backups"),
    appVersion: "1.2.3",
    config: createConfigStore(join(root, "config.json"), silentLogger),
    logger: silentLogger,
    migrations: [...migrations, ...extraMigrations],
  });
}

describe("workspace manager", () => {
  it("starts with no workspace", async () => {
    const workspaces = manager();
    expect(await workspaces.openActive()).toBeNull();
    expect(await workspaces.state()).toEqual({ status: "none" });
    expect(() => workspaces.require()).toThrow(/No workspace/);
  });

  it("creates the workspace layout and enters onboarding", async () => {
    const workspaces = manager();
    const workspace = await workspaces.create("Grace Chapel");
    for (const sub of ["media", "thumbs", "fonts", "workspace.db"]) {
      expect(existsSync(join(workspace.dir, sub)), sub).toBe(true);
    }
    expect(await workspaces.state()).toEqual({
      status: "onboarding",
      workspace: {
        id: workspace.id,
        churchName: "Grace Chapel",
        logoAssetId: null,
      },
    });
    await expect(workspaces.create("Again")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    workspaces.close();
  });

  it("reopens the active workspace after a restart, keeping settings", async () => {
    const first = manager();
    const workspace = await first.create("Grace Chapel");
    await workspace.settings.set("ui.theme", "light");
    await workspace.settings.set(
      "onboarding.completedAt",
      new Date().toISOString(),
    );
    first.close();

    const second = manager();
    const reopened = await second.openActive();
    expect(reopened?.id).toBe(workspace.id);
    expect(await reopened?.settings.get("ui.theme")).toBe("light");
    expect((await second.state()).status).toBe("ready");
    second.close();
  });

  it("backs up an existing workspace before applying a new migration", async () => {
    const first = manager();
    const { id } = await first.create("Grace Chapel");
    first.close();
    expect(existsSync(join(root, "backups"))).toBe(false);

    const upgraded = manager([
      {
        tag: "9999_add_column",
        sql: "ALTER TABLE churches ADD COLUMN motto TEXT;",
      },
    ]);
    await upgraded.openActive();
    upgraded.close();

    const backups = readdirSync(join(root, "backups"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^pre-migrate-1\.2\.3-.+\.db$/);
    // The backup is a consistent pre-migration snapshot.
    const snapshot = new DatabaseSync(join(root, "backups", backups[0]!), {
      readOnly: true,
    });
    const columns = snapshot
      .prepare("PRAGMA table_info(churches)")
      .all()
      .map((c) => c["name"]);
    expect(columns).not.toContain("motto");
    expect(snapshot.prepare("SELECT id FROM churches").get()?.["id"]).toBe(id);
    snapshot.close();
  });

  it("surfaces a failed migration and leaves the data untouched", async () => {
    const first = manager();
    await first.create("Grace Chapel");
    first.close();

    const broken = manager([{ tag: "9999_broken", sql: "NOT SQL;" }]);
    await expect(broken.openActive()).rejects.toBeInstanceOf(MigrationError);
    expect(broken.lastBackupPath).toMatch(/pre-migrate-/);

    const again = manager();
    const reopened = await again.openActive();
    expect(await reopened?.churches.getChurch(reopened.id)).toMatchObject({
      name: "Grace Chapel",
    });
    again.close();
  });

  it("starts fresh if the active workspace was deleted from disk", async () => {
    const first = manager();
    const workspace = await first.create("Grace Chapel");
    first.close();
    rmSync(workspace.dir, { recursive: true, force: true });

    const second = manager();
    expect(await second.openActive()).toBeNull();
    expect(await second.state()).toEqual({ status: "none" });
  });
});
