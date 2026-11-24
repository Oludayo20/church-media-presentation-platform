import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { AppError } from "@cmp/shared-types";
import type { Database, Db } from "../client";
import { newId, nowIso } from "../ids";
import {
  presentations,
  presentationVersions,
  slides,
  slideObjects,
  templates,
} from "../schema";

interface PresentationSnapshot {
  title: string;
  width: number;
  height: number;
  slides: readonly {
    id: string;
    background: {
      type: typeof slides.$inferSelect.backgroundType;
      value?: string;
      src?: string;
    };
    objects: readonly {
      id: string;
      type: typeof slideObjects.$inferSelect.objectType;
    }[];
    transition?: { type: string; ms: number } | undefined;
    durationMs?: number | undefined;
  }[];
}

export function createPresentationRepository(
  database: Database,
  churchId: string,
) {
  const { db } = database;

  function active(id: string) {
    return and(
      eq(presentations.churchId, churchId),
      eq(presentations.id, id),
      isNull(presentations.archivedAt),
    );
  }

  function latest(tx: Db, id: string) {
    return tx
      .select()
      .from(presentationVersions)
      .where(eq(presentationVersions.presentationId, id))
      .orderBy(desc(presentationVersions.version))
      .get();
  }

  async function requirePresentation(id: string) {
    const row = await db.select().from(presentations).where(active(id)).get();
    if (!row) throw new AppError("NOT_FOUND", "Presentation not found");
    return row;
  }

  return {
    templates: () =>
      db
        .select({ id: templates.id, name: templates.name })
        .from(templates)
        .where(eq(templates.churchId, churchId))
        .orderBy(templates.name),
    async template(id: string) {
      const row = await db
        .select({ document: templates.document })
        .from(templates)
        .where(and(eq(templates.id, id), eq(templates.churchId, churchId)))
        .get();
      if (!row) throw new AppError("NOT_FOUND", "Template not found");
      return row.document;
    },
    async saveTemplate(name: string, document: PresentationSnapshot) {
      const id = newId();
      const now = nowIso();
      const [record] = await db
        .insert(templates)
        .values({
          id,
          churchId,
          name,
          document,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: templates.id, name: templates.name });
      if (!record)
        throw new AppError(
          "CONFLICT",
          "A template with that name already exists",
        );
      return record;
    },
    list: () =>
      db
        .select({
          id: presentations.id,
          title: presentations.title,
          updatedAt: presentations.updatedAt,
        })
        .from(presentations)
        .where(
          and(
            eq(presentations.churchId, churchId),
            isNull(presentations.archivedAt),
          ),
        )
        .orderBy(desc(presentations.updatedAt), presentations.id),

    async get(id: string) {
      const row = await requirePresentation(id);
      const snapshot = await latest(db, id);
      if (snapshot)
        return { version: snapshot.version, snapshot: snapshot.snapshotJson };
      const records = await db.query.slides.findMany({
        where: eq(slides.presentationId, id),
        orderBy: slides.position,
      });
      const restored = [];
      for (const slide of records) {
        const objects = await db
          .select()
          .from(slideObjects)
          .where(eq(slideObjects.slideId, slide.id))
          .orderBy(slideObjects.zIndex);
        const src =
          slide.backgroundValue && `cmp-media://asset/${slide.backgroundValue}`;
        const background =
          slide.backgroundOptionsJson ??
          (slide.backgroundType === "image" || slide.backgroundType === "video"
            ? { type: slide.backgroundType, src }
            : {
                type: slide.backgroundType,
                value: slide.backgroundValue ?? "#151b28",
              });
        restored.push({
          id: slide.id,
          background,
          objects: objects.map((object) => ({
            ...(object.propertiesJson as object),
            id: object.id,
            type: object.objectType,
          })),
          transition: { type: slide.transitionType, ms: slide.transitionMs },
          durationMs: slide.durationMs ?? undefined,
        });
      }
      return {
        version: 0,
        snapshot: {
          schemaVersion: row.schemaVersion,
          id,
          title: row.title,
          width: row.width,
          height: row.height,
          slides: restored.length
            ? restored
            : [
                {
                  id: newId(),
                  background: { type: "color", value: "#151b28" },
                  objects: [],
                },
              ],
        },
      };
    },

    async versions(id: string) {
      await requirePresentation(id);
      return db
        .select({
          version: presentationVersions.version,
          createdAt: presentationVersions.createdAt,
        })
        .from(presentationVersions)
        .where(eq(presentationVersions.presentationId, id))
        .orderBy(desc(presentationVersions.version));
    },

    async version(id: string, version: number) {
      await requirePresentation(id);
      const row = await db
        .select({ snapshot: presentationVersions.snapshotJson })
        .from(presentationVersions)
        .where(
          and(
            eq(presentationVersions.presentationId, id),
            eq(presentationVersions.version, version),
          ),
        )
        .get();
      if (!row)
        throw new AppError("NOT_FOUND", "Presentation version not found");
      return row.snapshot;
    },

    save(
      id: string | null,
      oldVersion: number,
      document: PresentationSnapshot,
    ) {
      return database.transaction(async (tx) => {
        const presentationId = id ?? newId();
        const now = nowIso();
        const { title, width, height } = document;
        const aspectRatio =
          width * 9 === height * 16
            ? "16:9"
            : width * 3 === height * 4
              ? "4:3"
              : `${width}:${height}`;
        const metadata = { title, width, height, aspectRatio, updatedAt: now };
        if (id) {
          const current = await latest(tx, id);
          if ((current?.version ?? 0) !== oldVersion)
            throw new AppError(
              "CONFLICT",
              "This presentation was saved elsewhere. Reopen it and try again",
            );
          if (
            !(
              await tx
                .update(presentations)
                .set(metadata)
                .where(active(id))
                .returning()
            ).length
          ) {
            throw new AppError("NOT_FOUND", "Presentation not found");
          }
        } else {
          await tx.insert(presentations).values({
            id: presentationId,
            churchId,
            createdAt: now,
            ...metadata,
          });
        }

        // Keep the current slide tables in sync so the existing media deletion guard sees active references.
        await tx
          .delete(slides)
          .where(eq(slides.presentationId, presentationId));
        const insertSlide = database.sqlite.prepare(`INSERT INTO slides
          (id, presentation_id, position, slide_type, background_type, background_value, background_options_json, transition_type, transition_ms, duration_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const insertObject = database.sqlite.prepare(`INSERT INTO slide_objects
          (id, slide_id, object_type, z_index, properties_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`);
        for (const [position, slide] of document.slides.entries()) {
          const slideId = newId();
          const { background } = slide;
          const value =
            background.src?.match(/^cmp-media:\/\/asset\/(.+)$/u)?.[1] ??
            background.value ??
            null;
          insertSlide.run(
            slideId,
            presentationId,
            position,
            "custom",
            background.type,
            value,
            JSON.stringify(background),
            slide.transition?.type ?? "cut",
            slide.transition?.ms ?? 0,
            slide.durationMs ?? null,
            now,
          );
          for (const [layer, object] of slide.objects.entries()) {
            insertObject.run(
              newId(),
              slideId,
              object.type,
              layer,
              JSON.stringify(object),
              now,
            );
          }
        }

        const version = oldVersion + 1;
        const snapshot = { ...document, id: presentationId };
        await tx.insert(presentationVersions).values({
          id: newId(),
          presentationId,
          version,
          snapshotJson: snapshot,
          createdAt: now,
        });
        await tx
          .delete(presentationVersions)
          .where(
            and(
              eq(presentationVersions.presentationId, presentationId),
              lte(presentationVersions.version, version - 20),
            ),
          );
        return { version, snapshot };
      });
    },
  };
}
