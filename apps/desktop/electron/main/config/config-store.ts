import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Logger } from "../logging/logger";

const windowStateSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  maximized: z.boolean(),
  fullScreen: z.boolean(),
});
export type SavedWindowState = z.infer<typeof windowStateSchema>;

const configSchema = z.object({
  activeWorkspaceId: z.string().optional(),
  operatorWindow: windowStateSchema.optional(),
});
export type AppConfig = z.infer<typeof configSchema>;

export interface ConfigStore {
  get(): AppConfig;
  update(patch: Partial<AppConfig>): AppConfig;
}

/**
 * `<userData>/config.json`: machine-level state that lives outside any
 * workspace: the active workspace id and window bounds
 * (DOCUMENTATION.md §13). Writes are atomic (temp file + rename). A corrupt
 * file is moved aside and the defaults are used, so the app always starts.
 */
export function createConfigStore(path: string, logger: Logger): ConfigStore {
  let current = read();

  function read(): AppConfig {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return {};
    }
    try {
      return configSchema.parse(JSON.parse(raw));
    } catch (error) {
      const aside = `${path}.corrupt-${Date.now()}`;
      logger.warn(`[config] ${path} is invalid; moved to ${aside}`, error);
      try {
        renameSync(path, aside);
      } catch {
        // Best effort: the next write replaces it anyway.
      }
      return {};
    }
  }

  return {
    get: () => current,
    update(patch) {
      const next = configSchema.parse({ ...current, ...patch });
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
      renameSync(temp, path);
      current = next;
      return current;
    },
  };
}
