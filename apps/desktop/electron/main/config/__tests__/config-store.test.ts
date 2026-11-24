import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "../../logging/logger";
import { createConfigStore } from "../config-store";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmp-config-"));
  path = join(dir, "config.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("config store", () => {
  it("starts empty when there is no file", () => {
    expect(createConfigStore(path, silentLogger).get()).toEqual({});
  });

  it("persists updates atomically and reloads them", () => {
    createConfigStore(path, silentLogger).update({ activeWorkspaceId: "W1" });
    expect(readdirSync(dir)).toEqual(["config.json"]);
    expect(createConfigStore(path, silentLogger).get()).toEqual({
      activeWorkspaceId: "W1",
    });
  });

  it("merges patches and clears keys set to undefined", () => {
    const store = createConfigStore(path, silentLogger);
    store.update({ activeWorkspaceId: "W1" });
    store.update({
      operatorWindow: {
        x: 0,
        y: 0,
        width: 1200,
        height: 800,
        maximized: false,
        fullScreen: false,
      },
    });
    store.update({ activeWorkspaceId: undefined });
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(saved).not.toHaveProperty("activeWorkspaceId");
    expect(saved.operatorWindow.width).toBe(1200);
  });

  it("moves a corrupt file aside and falls back to defaults", () => {
    writeFileSync(path, "{ not json");
    const logger = { ...silentLogger, warn: vi.fn() };
    expect(createConfigStore(path, logger).get()).toEqual({});
    expect(logger.warn).toHaveBeenCalled();
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(dir)[0]).toMatch(/^config\.json\.corrupt-\d+$/);
  });

  it("treats a schema-invalid file as corrupt", () => {
    writeFileSync(path, JSON.stringify({ operatorWindow: { x: "left" } }));
    expect(createConfigStore(path, silentLogger).get()).toEqual({});
  });
});
