import { z } from "zod";
import { engineDocumentSchema } from "../engine-protocol";
import { settingsSchema, settingUpdateSchema } from "../settings-catalog";
import {
  bibleBookSchema,
  bibleCodeSchema,
  bibleTranslationSchema,
  scriptureCollectionSchema,
  scriptureRequestSchema,
} from "./bible";
import { appInfoSchema } from "./app";
import type { IPC_CHANNEL_NAMES, IPC_EVENT_NAMES } from "./channel-names";
import {
  displayIdInputSchema,
  displayStatusSchema,
  itemIndexInputSchema,
  liveStartInputSchema,
  liveStateSchema,
  liveVideoInputSchema,
  onInputSchema,
  slideIndexInputSchema,
} from "./live";
import {
  chooseAndImportInputSchema,
  createFolderInputSchema,
  idInputSchema,
  jobIdInputSchema,
  jobProgressSchema,
  mediaDetailSchema,
  mediaFolderSchema,
  mediaImportInputSchema,
  mediaItemSchema,
  mediaListInputSchema,
  mediaListOutputSchema,
  mediaUpdateInputSchema,
  renameFolderInputSchema,
  setLicenceInputSchema,
  setTagsInputSchema,
} from "./media";
import {
  parsedLyricsSchema,
  songCollectionSchema,
  songDataSchema,
  songDetailSchema,
  songImportResultSchema,
  songListInputSchema,
  songListItemSchema,
} from "./songs";
import {
  serviceCreateInputSchema,
  serviceDataSchema,
  serviceDetailSchema,
  serviceListItemSchema,
  servicePreviewItemSchema,
  serviceTemplateSchema,
} from "./services";
import {
  createWorkspaceInputSchema,
  renameWorkspaceInputSchema,
  workspaceStateSchema,
} from "./workspace";

const noInput = z.undefined();
const presentationVersion = z.int().nonnegative();
const presentationId = z.string().min(1).max(64);
const documentWithTitle = engineDocumentSchema.extend({
  title: z.string().trim().min(1).max(350),
});
const templateSummary = z.object({ id: presentationId, name: z.string() });
const savedPresentationSchema = z.object({
  version: presentationVersion,
  doc: engineDocumentSchema,
});
const liveScriptureRequest = scriptureRequestSchema.extend({
  sessionId: z.string().min(1).max(64),
});

/**
 * The single source of truth for IPC (docs/DOCUMENTATION.md §2.2): for each
 * channel, the schema the main process validates the payload against and the
 * schema of the `data` it answers with. The router refuses to start if a
 * channel here has no handler or a handler has no entry here.
 */
export const ipcChannels = {
  "app:info": { input: noInput, output: appInfoSchema },

  "workspace:get": { input: noInput, output: workspaceStateSchema },
  "workspace:create": {
    input: createWorkspaceInputSchema,
    output: workspaceStateSchema,
  },
  "workspace:rename": {
    input: renameWorkspaceInputSchema,
    output: workspaceStateSchema,
  },
  /** Opens a native file picker in main; the renderer never sends a path. */
  "workspace:chooseLogo": { input: noInput, output: workspaceStateSchema },
  "workspace:removeLogo": { input: noInput, output: workspaceStateSchema },
  "workspace:completeOnboarding": {
    input: noInput,
    output: workspaceStateSchema,
  },

  "settings:get": { input: noInput, output: settingsSchema },
  "settings:set": { input: settingUpdateSchema, output: settingsSchema },

  "displays:list": { input: noInput, output: displayStatusSchema },
  /** Shows a big number on every display for a few seconds. */
  "displays:identify": { input: noInput, output: displayStatusSchema },
  "displays:assign": {
    input: displayIdInputSchema,
    output: displayStatusSchema,
  },
  "displays:unassign": { input: noInput, output: displayStatusSchema },
  "displays:dismissNew": { input: noInput, output: displayStatusSchema },
  "displays:testPattern": { input: onInputSchema, output: liveStateSchema },

  "live:getState": { input: noInput, output: liveStateSchema },
  "live:start": { input: liveStartInputSchema, output: liveStateSchema },
  "live:end": { input: noInput, output: liveStateSchema },
  "live:next": { input: noInput, output: liveStateSchema },
  "live:prev": { input: noInput, output: liveStateSchema },
  "live:goto": { input: slideIndexInputSchema, output: liveStateSchema },
  "live:itemNext": { input: noInput, output: liveStateSchema },
  "live:itemPrev": { input: noInput, output: liveStateSchema },
  "live:itemGoto": { input: itemIndexInputSchema, output: liveStateSchema },
  "live:blank": { input: onInputSchema, output: liveStateSchema },
  "live:logo": { input: onInputSchema, output: liveStateSchema },
  "live:clear": { input: onInputSchema, output: liveStateSchema },
  "live:video": { input: liveVideoInputSchema, output: liveStateSchema },
  /** Shows a playlist item over the current one (Quick panel). */
  "live:overlayPush": { input: itemIndexInputSchema, output: liveStateSchema },
  "live:overlayPop": { input: noInput, output: liveStateSchema },
  /** After a disconnect: keep running with the in-app output only. */
  "live:continueInPreview": { input: noInput, output: liveStateSchema },
  /** A playlist item's resolved document, for operator previews. */
  "live:document": {
    input: itemIndexInputSchema,
    output: engineDocumentSchema,
  },
  /** Imports an image or video into the built-in test deck (Phase 2). */
  "live:addTestMedia": { input: noInput, output: liveStateSchema },

  "media:list": { input: mediaListInputSchema, output: mediaListOutputSchema },
  "media:get": { input: idInputSchema, output: mediaDetailSchema },
  /** Starts a worker job; progress arrives as `jobs:progress`. */
  "media:import": {
    input: mediaImportInputSchema,
    output: z.object({ jobId: z.string() }),
  },
  "media:chooseAndImport": {
    input: chooseAndImportInputSchema,
    output: z.object({ jobId: z.string().nullable() }),
  },
  "media:cancelJob": {
    input: jobIdInputSchema,
    output: z.object({ cancelled: z.boolean() }),
  },
  "media:update": { input: mediaUpdateInputSchema, output: mediaItemSchema },
  "media:setTags": { input: setTagsInputSchema, output: mediaItemSchema },
  "media:setLicence": {
    input: setLicenceInputSchema,
    output: mediaDetailSchema,
  },
  /** `CONFLICT` with `{ usedBy }` while anything references the asset. */
  "media:delete": {
    input: idInputSchema,
    output: z.object({ deleted: z.literal(true) }),
  },
  "media:scanMissing": {
    input: noInput,
    output: z.object({ missing: z.array(z.string()) }),
  },
  "media:transcode": {
    input: idInputSchema,
    output: z.object({ jobId: z.string() }),
  },
  "media:folders": { input: noInput, output: z.array(mediaFolderSchema) },
  "media:createFolder": {
    input: createFolderInputSchema,
    output: mediaFolderSchema,
  },
  "media:renameFolder": {
    input: renameFolderInputSchema,
    output: z.object({ ok: z.literal(true) }),
  },
  "media:deleteFolder": {
    input: idInputSchema,
    output: z.object({ ok: z.literal(true) }),
  },
  "media:tags": {
    input: noInput,
    output: z.array(z.object({ name: z.string(), count: z.number() })),
  },

  "songs:list": {
    input: songListInputSchema,
    output: z.array(songListItemSchema),
  },
  "songs:get": { input: idInputSchema, output: songDetailSchema },
  "songs:create": {
    input: z.object({ song: songDataSchema }),
    output: songDetailSchema,
  },
  /** Also live-patches the song if it is in the running session (§3.6). */
  "songs:update": {
    input: z.object({ id: z.string().min(1).max(64), song: songDataSchema }),
    output: songDetailSchema,
  },
  "songs:delete": {
    input: idInputSchema,
    output: z.object({ deleted: z.literal(true) }),
  },
  /** Pasted lyrics → sections + arrangement (ids assigned by main). */
  "songs:parseLyrics": {
    input: z.object({ text: z.string().max(100_000) }),
    output: parsedLyricsSchema,
  },
  /** Generates slides for an unsaved draft, exactly as the projector will. */
  "songs:preview": {
    input: z.object({ song: songDataSchema }),
    output: engineDocumentSchema,
  },
  /** Imports song files; without paths, opens a file picker. */
  "songs:import": {
    input: z
      .object({
        paths: z.array(z.string().min(1).max(4096)).max(200).optional(),
      })
      .optional(),
    output: songImportResultSchema,
  },
  "songs:collections": {
    input: noInput,
    output: z.array(songCollectionSchema),
  },
  "songs:createCollection": {
    input: z.object({ name: z.string().trim().min(1).max(60) }),
    output: songCollectionSchema,
  },
  "songs:templates": {
    input: noInput,
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
  /** Appends a song to the running session's playlist (until Phase 8 services). */
  "live:queueSong": {
    input: z.object({ songId: z.string().min(1).max(64) }),
    output: liveStateSchema,
  },
  "live:overlayDocument": {
    input: noInput,
    output: engineDocumentSchema.nullable(),
  },
  "bible:translations": {
    input: noInput,
    output: z.array(bibleTranslationSchema),
  },
  "bible:install": {
    input: noInput,
    output: bibleTranslationSchema.nullable(),
  },
  "bible:books": {
    input: z.object({ code: bibleCodeSchema }),
    output: z.array(bibleBookSchema),
  },
  "bible:addresses": {
    input: z.object({ code: bibleCodeSchema, bookId: z.int().positive() }),
    output: z.array(z.object({ chapter: z.int(), verse: z.int() })),
  },
  "bible:search": {
    input: z.object({
      code: bibleCodeSchema,
      query: z.string().trim().min(1).max(300),
    }),
    output: z.object({
      reference: z.string().nullable(),
      matches: z.array(
        z.object({ reference: z.string(), snippet: z.string() }),
      ),
    }),
  },
  "bible:preview": {
    input: scriptureRequestSchema,
    output: engineDocumentSchema,
  },
  "bible:show": { input: liveScriptureRequest, output: liveStateSchema },
  "bible:queue": { input: liveScriptureRequest, output: liveStateSchema },
  "bible:collections": {
    input: noInput,
    output: z.array(scriptureCollectionSchema),
  },
  "bible:createCollection": {
    input: z.object({ name: z.string().trim().min(1).max(80) }),
    output: scriptureCollectionSchema,
  },
  "bible:saved": {
    input: noInput,
    output: z.array(
      z.object({
        id: z.string(),
        translationCode: bibleCodeSchema,
        reference: z.string(),
        collectionId: z.string().nullable(),
      }),
    ),
  },
  "bible:save": {
    input: scriptureRequestSchema.extend({
      collectionId: z.string().min(1).max(64).nullable(),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
  "bible:remove": {
    input: idInputSchema,
    output: z.object({ ok: z.literal(true) }),
  },
  "bible:copyToPresentation": {
    input: scriptureRequestSchema,
    output: savedPresentationSchema,
  },
  "presentations:list": {
    input: noInput,
    output: z.array(
      z.object({
        id: presentationId,
        title: z.string(),
        updatedAt: z.string(),
      }),
    ),
  },
  "presentations:get": {
    input: idInputSchema,
    output: savedPresentationSchema,
  },
  "presentations:save": {
    input: z.object({
      id: presentationId.nullable(),
      version: presentationVersion,
      doc: documentWithTitle,
    }),
    output: savedPresentationSchema,
  },
  "presentations:versions": {
    input: idInputSchema,
    output: z.array(
      z.object({ version: presentationVersion, createdAt: z.string() }),
    ),
  },
  "presentations:restore": {
    input: z.object({
      id: presentationId,
      version: presentationVersion,
      restoreVersion: presentationVersion,
    }),
    output: savedPresentationSchema,
  },
  "presentations:queue": {
    input: z.object({
      id: presentationId,
      sessionId: z.string().min(1).max(64),
    }),
    output: liveStateSchema,
  },
  "presentations:templates": {
    input: noInput,
    output: z.array(templateSummary),
  },
  "presentations:template": {
    input: idInputSchema,
    output: engineDocumentSchema,
  },
  "presentations:saveTemplate": {
    input: z.object({
      name: z.string().trim().min(1).max(120),
      doc: documentWithTitle,
    }),
    output: templateSummary,
  },
  "presentations:importDocument": {
    input: noInput,
    output: savedPresentationSchema.nullable(),
  },
  "presentations:exportDocument": {
    input: z.object({ doc: documentWithTitle }),
    output: z.object({ saved: z.boolean() }),
  },
  /**
   * PowerPoint (.pptx) or PDF → a new presentation plus a conversion report
   * of what was dropped. Without a path, opens a file picker.
   */
  "presentations:importFile": {
    input: z
      .object({ path: z.string().min(1).max(4096).optional() })
      .optional(),
    output: z
      .object({
        presentation: savedPresentationSchema,
        report: z.array(z.object({ kind: z.string(), count: z.int() })),
      })
      .nullable(),
  },
  /** One PNG per slide into a folder chosen in a native dialog. */
  "presentations:exportImages": {
    input: z.object({ doc: documentWithTitle }),
    output: z.object({ count: z.int() }),
  },
  "services:list": { input: noInput, output: z.array(serviceListItemSchema) },
  "services:get": { input: idInputSchema, output: serviceDetailSchema },
  /** Creates a service, optionally from a template (§8.3). */
  "services:create": { input: serviceCreateInputSchema, output: serviceDetailSchema },
  /** Rewrites items and positions in one transaction; refs checked (§8.1). */
  "services:save": {
    input: z.object({ id: z.string().min(1).max(64), service: serviceDataSchema }),
    output: serviceDetailSchema,
  },
  /** Copies items with the same refs (§8.2). */
  "services:duplicate": {
    input: z.object({
      id: z.string().min(1).max(64),
      serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    }),
    output: serviceDetailSchema,
  },
  "services:delete": { input: idInputSchema, output: z.object({ deleted: z.literal(true) }) },
  "services:templates": { input: noInput, output: z.array(serviceTemplateSchema) },
  "services:saveTemplate": {
    input: z.object({ id: z.string().min(1).max(64), name: z.string().trim().min(1).max(80) }),
    output: z.object({ id: z.string(), name: z.string() }),
  },
  /** Resolves every item (§3.2) for the full-programme preview. */
  "services:preview": {
    input: idInputSchema,
    output: z.array(servicePreviewItemSchema.extend({ doc: engineDocumentSchema.nullable() })),
  },
  /** Starts a live session running this service (§3.2). */
  "services:start": {
    input: z.object({
      serviceId: z.string().min(1).max(64),
      startAt: z.object({ itemIndex: z.int().min(0), slideIndex: z.int().min(0) }).optional(),
    }),
    output: liveStateSchema,
  },
  /** Announcement rotation pauses on any manual command; this resumes it. */
  "live:resumeRotation": { input: noInput, output: liveStateSchema },
  "live:restartCountdown": { input: noInput, output: liveStateSchema },
  "songs:setFavourite": {
    input: z.object({ id: z.string().min(1).max(64), favourite: z.boolean() }),
    output: z.object({ favourite: z.boolean() }),
  },
  "songs:favourites": {
    input: noInput,
    output: z.array(z.object({ id: z.string(), title: z.string(), artist: z.string().nullable() })),
  },
  /** Disk used by the workspace (Home dashboard). */
  "workspace:storage": {
    input: noInput,
    output: z.object({ mediaBytes: z.number(), mediaCount: z.number(), databaseBytes: z.number() }),
  },
  /** Licensed, present imported fonts, registered with FontFace everywhere. */
  "fonts:list": {
    input: noInput,
    output: z.array(
      z.object({ id: z.string(), family: z.string(), name: z.string() }),
    ),
  },
  /**
   * Imports TTF/OTF fonts. The operator must confirm the church may use them
   * for projection; that acknowledgement is recorded as the font's licence.
   */
  "fonts:import": {
    input: z.object({
      acknowledged: z.literal(true),
      paths: z.array(z.string().min(1).max(4096)).min(1).max(50).optional(),
    }),
    output: z.object({ jobId: z.string().nullable() }),
  },
  /** The deck as a PDF (one slide per page), saved via a native dialog. */
  "presentations:exportPdf": {
    input: z.object({ doc: documentWithTitle }),
    output: z.object({ saved: z.boolean() }),
  },
} as const satisfies Record<
  (typeof IPC_CHANNEL_NAMES)[number],
  { input: z.ZodType; output: z.ZodType }
>;

export type IpcChannel = keyof typeof ipcChannels;

// Compile-time proof that channel-names.ts and the registry list the same
// channels (the `satisfies` above covers the other direction).
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _namesMatchRegistry: Exact<
  IpcChannel,
  (typeof IPC_CHANNEL_NAMES)[number]
> = true;
void _namesMatchRegistry;

/** Main → renderer push events and their payload schemas. */
export const ipcEvents = {
  "live:state": liveStateSchema,
  "displays:changed": displayStatusSchema,
  "jobs:progress": jobProgressSchema,
  "media:changed": z.object({ reason: z.string() }),
} as const satisfies Record<(typeof IPC_EVENT_NAMES)[number], z.ZodType>;

export type IpcEvent = keyof typeof ipcEvents;
export type EventPayload<E extends IpcEvent> = z.output<(typeof ipcEvents)[E]>;

/** What the renderer sends (before parsing/defaults). */
export type ChannelInput<C extends IpcChannel> = z.input<
  (typeof ipcChannels)[C]["input"]
>;
/** What the handler receives (after Zod parsing). */
export type ChannelPayload<C extends IpcChannel> = z.output<
  (typeof ipcChannels)[C]["input"]
>;
/** The `data` of a successful response. */
export type ChannelOutput<C extends IpcChannel> = z.output<
  (typeof ipcChannels)[C]["output"]
>;
