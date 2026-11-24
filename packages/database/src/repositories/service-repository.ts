import { and, asc, desc, eq } from "drizzle-orm";
import { AppError } from "@cmp/shared-types";
import type { Database } from "../client";
import { newId, nowIso } from "../ids";
import { SERVICE_ITEM_TYPES, serviceItemGroups, serviceItems, services, serviceTemplates } from "../schema";

export type ServiceItemType = (typeof SERVICE_ITEM_TYPES)[number];

export interface ServiceItemRecord {
  id: string;
  groupId: string | null;
  itemType: ServiceItemType;
  refId: string | null;
  options: unknown;
  label: string | null;
  notes: string | null;
}

export interface ServiceGroupRecord {
  id: string;
  name: string;
}

export interface ServiceFields {
  title: string;
  serviceType: string | null;
  serviceDate: string | null;
  startTime: string | null;
  theme: string | null;
  description: string | null;
}

export interface ServiceDraft extends ServiceFields {
  /** In display order; positions are rewritten from this order. */
  groups: ServiceGroupRecord[];
  /** In running order. */
  items: ServiceItemRecord[];
}

export interface ServiceRecord extends ServiceDraft {
  id: string;
  status: (typeof services.$inferSelect)["status"];
  createdAt: string;
  updatedAt: string;
}

export interface ServiceSummary {
  id: string;
  title: string;
  serviceType: string | null;
  serviceDate: string | null;
  startTime: string | null;
  status: string;
  itemCount: number;
  updatedAt: string;
}

/** Item types whose `ref_id` points at another table. */
const REF_TABLE: Partial<Record<ServiceItemType, { table: string; media?: "video" | "image" }>> = {
  presentation: { table: "presentations" },
  announcement: { table: "presentations" },
  song: { table: "songs" },
  video: { table: "media_assets", media: "video" },
  image: { table: "media_assets", media: "image" },
};

/**
 * Services, groups and polymorphic items (DOCUMENTATION.md §8.1). Every
 * save rewrites the item list and positions in one transaction, after
 * checking that each `ref_id` exists for its type (archived content is
 * still accepted: it stays resolvable).
 */
export function createServiceRepository(database: Database, churchId: string) {
  const { db, sqlite } = database;

  function checkRefs(items: ServiceItemRecord[]): void {
    const ids = items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION_ERROR", "Two service items share an id");
    const problems: string[] = [];
    for (const item of items) {
      const target = REF_TABLE[item.itemType];
      if (!target) {
        if (item.refId !== null) problems.push(`${item.itemType} items take no reference`);
        continue;
      }
      if (item.refId === null) continue; // a placeholder to fill in later
      const row = sqlite
        .prepare(
          target.media
            ? "SELECT media_type FROM media_assets WHERE id = ? AND church_id = ?"
            : `SELECT 1 FROM ${target.table} WHERE id = ? AND church_id = ?`,
        )
        .get(item.refId, churchId);
      if (!row) problems.push(`${item.label ?? item.itemType} points at something that no longer exists`);
      else if (target.media && row["media_type"] !== target.media) problems.push(`${item.label ?? item.itemType} is not a ${target.media}`);
    }
    if (problems.length > 0) throw new AppError("VALIDATION_ERROR", problems[0]!, { problems });
  }

  async function writeChildren(tx: Database["db"], serviceId: string, draft: ServiceDraft): Promise<void> {
    await tx.delete(serviceItems).where(eq(serviceItems.serviceId, serviceId));
    await tx.delete(serviceItemGroups).where(eq(serviceItemGroups.serviceId, serviceId));
    const groupIds = new Set<string>();
    for (const [position, group] of draft.groups.entries()) {
      await tx.insert(serviceItemGroups).values({ id: group.id, serviceId, name: group.name, position });
      groupIds.add(group.id);
    }
    const timestamp = nowIso();
    for (const [position, item] of draft.items.entries()) {
      await tx.insert(serviceItems).values({
        id: item.id,
        serviceId,
        groupId: item.groupId && groupIds.has(item.groupId) ? item.groupId : null,
        position,
        itemType: item.itemType,
        refId: item.refId,
        optionsJson: item.options,
        label: item.label,
        notes: item.notes,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  function fields(draft: ServiceFields) {
    return {
      title: draft.title,
      serviceType: draft.serviceType,
      serviceDate: draft.serviceDate,
      startTime: draft.startTime,
      theme: draft.theme,
      description: draft.description,
    };
  }

  async function get(id: string): Promise<ServiceRecord | null> {
    const row = await db.query.services.findFirst({ where: and(eq(services.id, id), eq(services.churchId, churchId)) });
    if (!row) return null;
    const [groups, items] = await Promise.all([
      db.select().from(serviceItemGroups).where(eq(serviceItemGroups.serviceId, id)).orderBy(asc(serviceItemGroups.position)),
      db.select().from(serviceItems).where(eq(serviceItems.serviceId, id)).orderBy(asc(serviceItems.position)),
    ]);
    return {
      id: row.id,
      ...fields(row),
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
      items: items.map((item) => ({
        id: item.id,
        groupId: item.groupId,
        itemType: item.itemType,
        refId: item.refId,
        options: item.optionsJson,
        label: item.label,
        notes: item.notes,
      })),
    };
  }

  async function requireService(id: string): Promise<ServiceRecord> {
    const service = await get(id);
    if (!service) throw new AppError("NOT_FOUND", "Service not found");
    return service;
  }

  async function create(draft: ServiceDraft): Promise<ServiceRecord> {
    checkRefs(draft.items);
    const id = newId();
    const timestamp = nowIso();
    await database.transaction(async (tx) => {
      await tx.insert(services).values({ id, churchId, ...fields(draft), createdAt: timestamp, updatedAt: timestamp });
      await writeChildren(tx, id, draft);
    });
    return requireService(id);
  }

  return {
    get,
    create,

    async list(): Promise<ServiceSummary[]> {
      return sqlite
        .prepare(
          `SELECT s.id, s.title, s.service_type, s.service_date, s.start_time, s.status, s.updated_at,
                  (SELECT count(*) FROM service_items i WHERE i.service_id = s.id) AS item_count
             FROM services s WHERE s.church_id = ? AND s.status <> 'archived'
            ORDER BY s.service_date DESC, s.start_time DESC, s.updated_at DESC`,
        )
        .all(churchId)
        .map((row) => ({
          id: String(row["id"]),
          title: String(row["title"]),
          serviceType: row["service_type"] === null ? null : String(row["service_type"]),
          serviceDate: row["service_date"] === null ? null : String(row["service_date"]),
          startTime: row["start_time"] === null ? null : String(row["start_time"]),
          status: String(row["status"]),
          itemCount: Number(row["item_count"]),
          updatedAt: String(row["updated_at"]),
        }));
    },

    async save(id: string, draft: ServiceDraft): Promise<ServiceRecord> {
      await requireService(id);
      checkRefs(draft.items);
      await database.transaction(async (tx) => {
        await tx.update(services).set({ ...fields(draft), updatedAt: nowIso() }).where(eq(services.id, id));
        await writeChildren(tx, id, draft);
      });
      return requireService(id);
    },

    async setStatus(id: string, status: ServiceRecord["status"]): Promise<void> {
      await db.update(services).set({ status, updatedAt: nowIso() }).where(and(eq(services.id, id), eq(services.churchId, churchId)));
    },

    /** Copies the service with the same refs; new ids, a new date (§8.2). */
    async duplicate(id: string, serviceDate: string | null): Promise<ServiceRecord> {
      const source = await requireService(id);
      const groupIds = new Map(source.groups.map((group) => [group.id, newId()]));
      return create({
        ...source,
        serviceDate,
        groups: source.groups.map((group) => ({ id: groupIds.get(group.id)!, name: group.name })),
        items: source.items.map((item) => ({
          ...item,
          id: newId(),
          groupId: item.groupId ? (groupIds.get(item.groupId) ?? null) : null,
        })),
      });
    },

    async delete(id: string): Promise<void> {
      await requireService(id);
      await db.delete(services).where(eq(services.id, id));
    },

    /** Services that use a song, presentation or media asset (delete guard). */
    async usage(refId: string): Promise<{ id: string; title: string; serviceDate: string | null }[]> {
      return sqlite
        .prepare(
          `SELECT DISTINCT s.id, s.title, s.service_date FROM service_items i JOIN services s ON s.id = i.service_id
            WHERE s.church_id = ? AND i.ref_id = ? ORDER BY s.service_date DESC`,
        )
        .all(churchId, refId)
        .map((row) => ({
          id: String(row["id"]),
          title: String(row["title"]),
          serviceDate: row["service_date"] === null ? null : String(row["service_date"]),
        }));
    },

    async templates(): Promise<{ id: string; name: string; definition: unknown }[]> {
      const rows = await db
        .select()
        .from(serviceTemplates)
        .where(eq(serviceTemplates.churchId, churchId))
        .orderBy(desc(serviceTemplates.createdAt));
      return rows.map((row) => ({ id: row.id, name: row.name, definition: row.definitionJson }));
    },

    async saveTemplate(name: string, definition: unknown): Promise<{ id: string; name: string }> {
      const id = newId();
      await db.insert(serviceTemplates).values({ id, churchId, name, definitionJson: definition, createdAt: nowIso() });
      return { id, name };
    },
  };
}

export type ServiceRepository = ReturnType<typeof createServiceRepository>;
