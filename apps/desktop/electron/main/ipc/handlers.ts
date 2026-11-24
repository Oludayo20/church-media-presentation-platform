import { open, writeFile } from "node:fs/promises";
import { builtInTemplates } from "../presentations/templates";
import type { BibleService } from "../bible/bible-service";
import type { AppInfo } from "@cmp/shared-types";
import { parseEngineDocument, type Settings } from "@cmp/shared-validation";
import { AppError } from "@cmp/shared-types";
import { importImageFile } from "../media/media-import";
import type { LiveRuntime } from "../live/live-runtime";
import type { MediaLibrary } from "../media/media-library";
import type { PresentationFiles } from "../presentations/presentation-files";
import type { ServiceService } from "../services/service-service";
import type { SongService } from "../songs/song-service";
import type { WorkspaceManager } from "../workspace/workspace-manager";
import type { IpcHandlers } from "./router";

const MAX_PRESENTATION_FILE_BYTES = 16 * 1024 * 1024;

export interface HandlerDeps {
  appInfo(): AppInfo;
  workspaces: WorkspaceManager;
  /** Native "open image" dialog; resolves to a path or null if cancelled. */
  chooseImageFile(): Promise<string | null>;
  choosePresentationFile(): Promise<string | null>;
  choosePresentationDestination(title: string): Promise<string | null>;
  onSettingsChanged(settings: Settings): void;
  live: LiveRuntime;
  media: MediaLibrary;
  songs: SongService;
  bible: BibleService;
  services: ServiceService;
  files: PresentationFiles;
  /** Native "open fonts" dialog. */
  chooseFontFiles(): Promise<string[]>;
}

/**
 * Every IPC handler, built from injected dependencies so the full set can be
 * exercised in unit tests without Electron. Input is already validated by
 * the router; handlers throw `AppError` for expected failures.
 */
export function createIpcHandlers(deps: HandlerDeps): IpcHandlers {
  const { workspaces, live, media, songs, bible, files, services } = deps;
  const scriptures = () => workspaces.require().bible;
  const presentations = () => workspaces.require().presentations;
  const readDocument = (snapshot: unknown) => {
    const result = parseEngineDocument(snapshot);
    if (!result.success) throw new AppError("VALIDATION_ERROR", result.error);
    return result.doc;
  };
  const savedPresentation = ({
    version,
    snapshot,
  }: {
    version: number;
    snapshot: unknown;
  }) => ({ version, doc: readDocument(snapshot) });
  const library = () => workspaces.require().library;
  const session = () => {
    workspaces.require();
    return live.controller;
  };

  return {
    "app:info": () => deps.appInfo(),

    "workspace:get": () => workspaces.state(),

    "workspace:create": async ({ churchName }) => {
      await workspaces.create(churchName);
      await live.workspaceReady();
      return workspaces.state();
    },

    "workspace:rename": async ({ churchName }) => {
      const workspace = workspaces.require();
      await workspace.churches.rename(workspace.id, churchName);
      return workspaces.state();
    },

    "workspace:chooseLogo": async () => {
      const workspace = workspaces.require();
      const sourcePath = await deps.chooseImageFile();
      if (sourcePath) {
        const asset = await importImageFile({
          sourcePath,
          mediaDir: workspace.mediaDir,
          churchId: workspace.id,
          category: "logo",
          media: workspace.media,
        });
        await workspace.churches.setLogo(workspace.id, asset.id);
      }
      return workspaces.state();
    },

    "workspace:removeLogo": async () => {
      const workspace = workspaces.require();
      await workspace.churches.setLogo(workspace.id, null);
      return workspaces.state();
    },

    "workspace:completeOnboarding": async () => {
      const workspace = workspaces.require();
      if (!(await workspace.settings.get("onboarding.completedAt"))) {
        await workspace.settings.set(
          "onboarding.completedAt",
          new Date().toISOString(),
        );
      }
      return workspaces.state();
    },

    "settings:get": () => workspaces.require().settings.getAll(),

    "settings:set": async ({ key, value }) => {
      const { settings } = workspaces.require();
      // The router validated `value` against `key`'s schema; TypeScript
      // cannot correlate the two halves of the union.
      await settings.set(key, value as never);
      const all = await settings.getAll();
      deps.onSettingsChanged(all);
      if (live.controller.active) await live.settingsChanged();
      return all;
    },

    "displays:list": () => live.displays.status(),
    "displays:identify": () => {
      live.identify();
      return live.displays.status();
    },
    "displays:assign": ({ displayId }) => {
      workspaces.require();
      return live.displays.assign(displayId);
    },
    "displays:unassign": () => live.displays.unassign(),
    "displays:dismissNew": () => live.displays.dismissNew(),
    "displays:testPattern": ({ on }) => {
      workspaces.require();
      return live.testPattern(on);
    },

    "live:getState": () => live.controller.state(),
    "live:start": (input) => {
      workspaces.require();
      return live.start(input?.startAt);
    },
    "live:end": async () => {
      const serviceId = live.controller.state().service?.id;
      const state = await live.end();
      await services.sessionEnded(serviceId);
      return state;
    },
    "live:resumeRotation": () => session().resumeRotation(),
    "live:restartCountdown": () => session().restartCountdown(),
    "services:list": () => services.list(),
    "services:get": ({ id }) => services.get(id),
    "services:create": (input) => services.create(input),
    "services:save": ({ id, service }) => services.save(id, service),
    "services:duplicate": ({ id, serviceDate }) => services.duplicate(id, serviceDate),
    "services:delete": async ({ id }) => {
      await services.delete(id);
      return { deleted: true as const };
    },
    "services:templates": () => services.templates(),
    "services:saveTemplate": ({ id, name }) => services.saveTemplate(id, name),
    "services:preview": ({ id }) => services.preview(id),
    "services:start": ({ serviceId, startAt }) => services.start(serviceId, startAt),
    "songs:setFavourite": async ({ id, favourite }) => {
      await workspaces.require().songs.setFavourite(id, favourite);
      return { favourite };
    },
    "songs:favourites": () => workspaces.require().songs.favourites(12),
    "workspace:storage": async () => {
      const workspace = workspaces.require();
      const row = workspace.database.sqlite
        .prepare("SELECT count(*) AS n, coalesce(sum(file_size), 0) AS bytes FROM media_assets WHERE church_id = ?")
        .get(workspace.id);
      const pages = workspace.database.sqlite.prepare("PRAGMA page_count").get();
      const size = workspace.database.sqlite.prepare("PRAGMA page_size").get();
      return {
        mediaBytes: Number(row?.["bytes"] ?? 0),
        mediaCount: Number(row?.["n"] ?? 0),
        databaseBytes: Number(pages?.["page_count"] ?? 0) * Number(size?.["page_size"] ?? 0),
      };
    },
    "live:next": () => session().next(),
    "live:prev": () => session().prev(),
    "live:goto": ({ slideIndex }) => session().goto(slideIndex),
    "live:itemNext": () => session().itemNext(),
    "live:itemPrev": () => session().itemPrev(),
    "live:itemGoto": ({ itemIndex }) => session().itemGoto(itemIndex),
    "live:blank": ({ on }) => session().blank(on),
    "live:logo": ({ on }) => session().logo(on),
    "live:clear": ({ on }) => session().clear(on),
    "live:video": ({ action, value }) => session().video(action, value),
    "live:overlayPush": ({ itemIndex }) => session().overlayPush(itemIndex),
    "live:overlayPop": () => session().overlayPop(),
    "live:continueInPreview": () => live.continueInPreview(),
    "live:document": ({ itemIndex }) => session().document(itemIndex),
    "live:addTestMedia": () => live.addTestMedia(),

    "media:list": async (filter) => {
      const page = await library().list(filter);
      return {
        items: page.items.map(media.toItem),
        nextCursor: page.nextCursor,
      };
    },
    "media:get": ({ id }) => media.get(id),
    "media:import": (request) => ({ jobId: media.import(request) }),
    "media:chooseAndImport": async (input) => ({
      jobId: await media.chooseAndImport(input?.folderId),
    }),
    "media:cancelJob": ({ jobId }) => ({ cancelled: media.cancel(jobId) }),
    "media:update": async ({ id, patch }) =>
      media.toItem(
        await library().update(id, {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.folderId !== undefined && { folderId: patch.folderId }),
          ...(patch.category !== undefined && { category: patch.category }),
          ...(patch.isFavourite !== undefined && {
            isFavourite: patch.isFavourite,
          }),
        }),
      ),
    "media:setTags": async ({ id, tags }) =>
      media.toItem(await library().setTags(id, tags)),
    "media:setLicence": async ({ id, licence }) => {
      await library().setLicence(id, licence);
      return media.get(id);
    },
    "media:delete": async ({ id }) => {
      await media.delete(id);
      return { deleted: true as const };
    },
    "media:scanMissing": async () => ({ missing: await media.scanMissing() }),
    "media:transcode": async ({ id }) => ({ jobId: await media.transcode(id) }),
    "media:folders": () => library().folders(),
    "media:createFolder": ({ name, parentId }) =>
      library().createFolder(name, parentId ?? null),
    "media:renameFolder": async ({ id, name }) => {
      await library().renameFolder(id, name);
      return { ok: true as const };
    },
    "media:deleteFolder": async ({ id }) => {
      await library().deleteFolder(id);
      return { ok: true as const };
    },
    "media:tags": () => library().tags(),

    "songs:list": (search) => songs.list(search),
    "songs:get": ({ id }) => songs.get(id),
    "songs:create": ({ song }) => songs.create(song),
    "songs:update": ({ id, song }) => songs.update(id, song),
    "songs:delete": async ({ id }) => {
      await songs.delete(id);
      return { deleted: true as const };
    },
    "songs:parseLyrics": ({ text }) => {
      workspaces.require();
      return songs.parseLyrics(text);
    },
    "songs:preview": ({ song }) => songs.preview(song),
    "songs:import": (input) => songs.import(input?.paths),
    "songs:collections": () => songs.collections(),
    "songs:createCollection": ({ name }) => songs.createCollection(name),
    "songs:templates": () => songs.templates(),
    "live:queueSong": ({ songId }) => songs.queueSong(songId),
    "live:overlayDocument": () => session().overlayDocument(),
    "bible:translations": () => scriptures().translations(),
    "bible:install": () => bible.install(),
    "bible:books": ({ code }) => scriptures().books(code),
    "bible:addresses": async ({ code, bookId }) => {
      const repository = scriptures();
      if (!(await repository.books(code)).some(({ id }) => id === bookId))
        return [];
      return (await repository.verses(bookId)).map(({ chapter, verse }) => ({
        chapter,
        verse,
      }));
    },
    "bible:search": ({ code, query }) => bible.search(code, query),
    "bible:preview": ({ code, reference }) =>
      bible.requirePassage(code, reference),
    "bible:show": ({ code, reference, sessionId }) =>
      bible.show(code, reference, sessionId),
    "bible:queue": ({ code, reference, sessionId }) =>
      bible.queue(code, reference, sessionId),
    "bible:collections": () => scriptures().collections(),
    "bible:createCollection": ({ name }) => scriptures().createCollection(name),
    "bible:saved": () => scriptures().saved(),
    "bible:save": async ({ code, reference, collectionId }) => {
      const doc = await bible.requirePassage(code, reference);
      await scriptures().save(code, doc.title, collectionId);
      return { ok: true as const };
    },
    "bible:copyToPresentation": async ({ code, reference }) =>
      savedPresentation(
        await presentations().save(
          null,
          0,
          await bible.requirePassage(code, reference),
        ),
      ),
    "presentations:list": () => presentations().list(),
    "presentations:get": async ({ id }) =>
      savedPresentation(await presentations().get(id)),
    "presentations:save": async ({ id, version, doc }) =>
      savedPresentation(await presentations().save(id, id ? version : 0, doc)),
    "presentations:templates": async () => [
      ...builtInTemplates.map(({ id, name }) => ({ id, name })),
      ...(await presentations().templates()),
    ],
    "presentations:template": async ({ id }) =>
      builtInTemplates.find((template) => template.id === id)?.doc ??
      readDocument(await presentations().template(id)),
    "presentations:saveTemplate": ({ name, doc }) =>
      presentations().saveTemplate(name, doc),
    "presentations:importDocument": async () => {
      const repo = presentations();
      if (live.controller.active)
        throw new AppError(
          "CONFLICT",
          "End the live session before importing a presentation",
        );
      const path = await deps.choosePresentationFile();
      if (!path) return null;
      const file = await open(path, "r");
      let source;
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > MAX_PRESENTATION_FILE_BYTES)
          throw new AppError(
            "VALIDATION_ERROR",
            "Presentation exceeds the 16 MB import limit",
          );
        const bytes = Buffer.alloc(info.size + 1);
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
        if (bytesRead !== info.size)
          throw new AppError(
            "VALIDATION_ERROR",
            "Presentation changed during import",
          );
        source = bytes.subarray(0, bytesRead).toString("utf8");
      } finally {
        await file.close();
      }
      if (live.controller.active || repo !== presentations())
        throw new AppError("CONFLICT", "The workspace is busy. Try again");
      let parsed: unknown;
      try {
        parsed = JSON.parse(source);
      } catch {
        throw new AppError(
          "VALIDATION_ERROR",
          "The presentation file does not contain valid JSON",
        );
      }
      const doc = readDocument(parsed);
      if (!doc.title.trim() || doc.title.length > 350)
        throw new AppError(
          "VALIDATION_ERROR",
          "Presentation title must be 1–350 characters",
        );
      if (
        new Set(doc.slides.map(({ id }) => id)).size !== doc.slides.length ||
        doc.slides.some(
          (slide) =>
            new Set(slide.objects.map(({ id }) => id)).size !==
            slide.objects.length,
        )
      ) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Slide and object IDs must be unique",
        );
      }
      return savedPresentation(await repo.save(null, 0, doc));
    },
    "presentations:exportDocument": async ({ doc }) => {
      workspaces.require();
      const path = await deps.choosePresentationDestination(doc.title);
      if (!path) return { saved: false };
      const data = JSON.stringify(doc, null, 2);
      if (Buffer.byteLength(data) > MAX_PRESENTATION_FILE_BYTES)
        throw new AppError(
          "VALIDATION_ERROR",
          "Presentation exceeds the 16 MB export limit",
        );
      await writeFile(path, data, "utf8");
      return { saved: true };
    },
    "fonts:list": async () =>
      (await library().licensedFonts()).map(({ id, family, name }) => ({
        id,
        family,
        name,
      })),
    "fonts:import": async ({ paths }) => {
      workspaces.require();
      const chosen = paths ?? (await deps.chooseFontFiles());
      if (chosen.length === 0) return { jobId: null };
      if (chosen.some((path) => !/\.(ttf|otf)$/i.test(path))) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Choose TrueType (.ttf) or OpenType (.otf) fonts",
        );
      }
      return {
        jobId: media.import({
          paths: chosen,
          licence: {
            licenceType: "licensed",
            source: null,
            attribution: null,
            terms: `Projection use confirmed by the operator on ${new Date().toISOString().slice(0, 10)}`,
          },
        }),
      };
    },
    "presentations:importFile": (input) => files.importFile(input?.path),
    "presentations:exportImages": ({ doc }) => files.exportImages(doc),
    "presentations:exportPdf": ({ doc }) => files.exportPdf(doc),
    "presentations:versions": ({ id }) => presentations().versions(id),
    "presentations:restore": async ({ id, version, restoreVersion }) => {
      const repo = presentations();
      const doc = readDocument(await repo.version(id, restoreVersion));
      return savedPresentation(await repo.save(id, version, doc));
    },
    "presentations:queue": async ({ id, sessionId }) => {
      const { doc } = savedPresentation(await presentations().get(id));
      const controller = session();
      if (controller.state().sessionId !== sessionId)
        throw new AppError("CONFLICT", "The live session changed");
      return controller.appendItem({
        id: `presentation:${id}`,
        kind: "presentation",
        title: doc.title,
        doc,
      });
    },
    "bible:remove": async ({ id }) => {
      await scriptures().remove(id);
      return { ok: true as const };
    },
  };
}
