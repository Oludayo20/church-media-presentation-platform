import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { settings } from "../schema";

/**
 * One typed setting: its default and a parser that validates stored and
 * incoming values. Structurally compatible with a Zod schema, so the shared
 * catalogue (`@cmp/shared-validation`) plugs in without this package
 * depending on Zod.
 */
export interface SettingDefinition<T> {
  readonly default: T;
  readonly schema: { parse(value: unknown): T };
}

export type SettingsCatalog = Record<string, SettingDefinition<unknown>>;

export type SettingsValues<C extends SettingsCatalog> = {
  [K in keyof C]: C[K] extends SettingDefinition<infer T> ? T : never;
};

export interface SettingsRepositoryOptions {
  /** Called when a stored value no longer parses; the default is used. */
  onInvalid?: (key: string, error: unknown) => void;
}

/**
 * Typed key/value settings (DOCUMENTATION.md §13). Only keys in the catalogue
 * can be read or written. Values are validated on write, and on read a value
 * that no longer validates (corruption, an older format) falls back to the
 * default instead of breaking the app.
 */
export function createSettingsRepository<C extends SettingsCatalog>(
  database: Database,
  churchId: string,
  catalog: C,
  options: SettingsRepositoryOptions = {},
) {
  const { db } = database;
  type Key = keyof C & string;
  type Values = SettingsValues<C>;

  function decode<K extends Key>(key: K, valueJson: string | undefined) {
    const definition = catalog[key];
    if (!definition) throw new Error(`Unknown setting: ${key}`);
    if (valueJson === undefined) return definition.default as Values[K];
    try {
      return definition.schema.parse(JSON.parse(valueJson)) as Values[K];
    } catch (error) {
      options.onInvalid?.(key, error);
      return definition.default as Values[K];
    }
  }

  return {
    async get<K extends Key>(key: K): Promise<Values[K]> {
      const row = await db.query.settings.findFirst({
        where: and(eq(settings.churchId, churchId), eq(settings.key, key)),
      });
      return decode(key, row?.valueJson);
    },

    async getAll(): Promise<Values> {
      const rows = await db.query.settings.findMany({
        where: eq(settings.churchId, churchId),
      });
      const stored = new Map(rows.map((row) => [row.key, row.valueJson]));
      const values = {} as Values;
      for (const key of Object.keys(catalog) as Key[]) {
        values[key] = decode(key, stored.get(key));
      }
      return values;
    },

    async set<K extends Key>(key: K, value: Values[K]): Promise<Values[K]> {
      const definition = catalog[key];
      if (!definition) throw new Error(`Unknown setting: ${key}`);
      const parsed = definition.schema.parse(value) as Values[K];
      const valueJson = JSON.stringify(parsed);
      await db
        .insert(settings)
        .values({ churchId, key, valueJson })
        .onConflictDoUpdate({
          target: [settings.churchId, settings.key],
          set: { valueJson },
        });
      return parsed;
    },

    /** Removes the stored value so the default applies again. */
    async reset<K extends Key>(key: K): Promise<Values[K]> {
      await db
        .delete(settings)
        .where(and(eq(settings.churchId, churchId), eq(settings.key, key)));
      return decode(key, undefined);
    },
  };
}

export type SettingsRepository<C extends SettingsCatalog> = ReturnType<
  typeof createSettingsRepository<C>
>;
