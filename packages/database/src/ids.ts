import { monotonicFactory } from "ulid";

const ulid = monotonicFactory();

/** ULIDs: sortable, generated client-side so retried creates can upsert. */
export function newId(): string {
  return ulid();
}

/** ISO-8601 UTC, the storage format of every timestamp column. */
export function nowIso(): string {
  return new Date().toISOString();
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
