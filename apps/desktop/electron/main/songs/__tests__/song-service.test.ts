import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SongData } from "@cmp/shared-types";
import {
  engineDocumentSchema,
  type EngineCommandBody,
} from "@cmp/shared-validation";
import { createConfigStore } from "../../config/config-store";
import { JobRunner } from "../../jobs/job-runner";
import { inProcessWorker } from "../../jobs/__tests__/in-process-worker";
import { LiveSessionController } from "../../live/live-session";
import { silentLogger } from "../../logging/logger";
import {
  createWorkspaceManager,
  type WorkspaceManager,
} from "../../workspace/workspace-manager";
import { createSongService, type SongService } from "../song-service";

let root: string;
let workspaces: WorkspaceManager;
let controller: LiveSessionController;
let service: SongService;
let sent: EngineCommandBody[];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "cmp-songs-"));
  workspaces = createWorkspaceManager({
    workspacesDir: join(root, "w"),
    backupsDir: join(root, "b"),
    appVersion: "1",
    config: createConfigStore(join(root, "config.json"), silentLogger),
    logger: silentLogger,
  });
  await workspaces.create("Grace");
  controller = new LiveSessionController({
    loadPlaylist: async () => [
      {
        id: "welcome",
        title: "Welcome",
        kind: "announcement",
        doc: engineDocumentSchema.parse({
          schemaVersion: "cmp.presentation/v1",
          id: "welcome",
          title: "Welcome",
          width: 1920,
          height: 1080,
          slides: [
            {
              id: "w",
              background: { type: "color", value: "#000000" },
              objects: [],
            },
          ],
        }),
      },
    ],
    engineConfig: async () => ({
      fallbackBackground: { type: "color", value: "#000" },
      logoSrc: null,
      logoText: null,
      safeAreaPct: 5,
      defaultTransition: { type: "cut", ms: 0 },
    }),
    journal: () => null,
    displayProfileId: () => null,
    onState: () => {},
    logger: silentLogger,
  });
  sent = [];
  await controller.addSink(
    { id: "audience", send: (command) => sent.push(command) },
    { primary: true },
  );
  service = createSongService({
    workspaces,
    jobs: new JobRunner(inProcessWorker, silentLogger),
    live: () => controller,
    logger: silentLogger,
    chooseFiles: async () => [],
  });
});
afterEach(() => {
  controller.dispose();
  workspaces.close();
  rmSync(root, { recursive: true, force: true });
});

function draft(text: string, title = "Morning Song"): SongData {
  const { sections, arrangement } = service.parseLyrics(text);
  return {
    title,
    artist: "A. Writer",
    language: "en",
    category: null,
    copyrightOwner: null,
    copyrightYear: null,
    ccliNumber: null,
    licenceReference: null,
    tags: [],
    collectionIds: [],
    backgroundAssetId: null,
    templateId: null,
    split: null,
    sections,
    arrangement,
  };
}

const LYRICS =
  "Verse 1\nmorning light\nover hills\n\nChorus\nsing a new song\nlift your voice";

describe("song service", () => {
  it("parses pasted lyrics with fresh section ids and seeds the built-in collections", async () => {
    const data = draft(LYRICS);
    expect(data.sections.map((s) => s.label)).toEqual(["Verse 1", "Chorus"]);
    expect(data.arrangement).toEqual(data.sections.map((s) => s.id));
    const created = await service.create(data);
    expect((await service.get(created.id)).title).toBe("Morning Song");
    expect((await service.collections()).map((c) => c.name)).toEqual([
      "Praise",
      "Worship",
      "Hymns",
      "Communion",
      "Christmas",
      "Easter",
      "Nigerian gospel",
    ]);
  });

  it("preview uses the workspace split setting and copyright setting", async () => {
    const preview = await service.preview(draft(LYRICS));
    expect(preview.slides).toHaveLength(2); // two lines per slide by default
    const workspace = workspaces.require();
    await workspace.settings.set("songs.split", {
      mode: "lines",
      linesPerSlide: 1,
      maxChars: 120,
      blankBetweenSections: false,
    });
    expect((await service.preview(draft(LYRICS))).slides).toHaveLength(4);
  });

  it("queues a song into the live session and live-patches only the edited slides", async () => {
    const created = await service.create(draft(LYRICS));
    await expect(service.queueSong(created.id)).rejects.toMatchObject({
      code: "CONFLICT",
    }); // no session yet
    await controller.start({ output: "display" });
    const state = await service.queueSong(created.id);
    expect(state.items.map((item) => item.title)).toEqual([
      "Welcome",
      "Morning Song",
    ]);
    await expect(service.queueSong(created.id)).rejects.toThrow(
      /already in the playlist/,
    );

    controller.itemGoto(1);
    sent = [];
    const chorus = created.sections[1]!;
    await service.update(created.id, {
      ...created,
      sections: [
        created.sections[0]!,
        { ...chorus, lyrics: "sing a NEW song\nlift your voice" },
      ],
    });
    const patches = sent.filter((command) => command.type === "patch");
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ slideId: `${chorus.id}~0~0` });
    expect(sent.some((command) => command.type === "load")).toBe(false);
    expect(controller.state().items[1]!.revision).toBe(1);
  });

  it("imports song files through the worker and reports failures", async () => {
    writeFileSync(
      join(root, "Evening Hymn.txt"),
      "Verse 1\nline one\n\nChorus\nline two",
    );
    writeFileSync(
      join(root, "song.xml"),
      `<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9"><properties><titles><title>Open Song</title></titles></properties><lyrics><verse name="v1"><lines>a line</lines></verse></lyrics></song>`,
    );
    writeFileSync(
      join(root, "picture.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    const result = await service.import([
      join(root, "Evening Hymn.txt"),
      join(root, "song.xml"),
      join(root, "picture.png"),
    ]);
    expect(result.imported.map((song) => song.title)).toEqual([
      "Evening Hymn",
      "Open Song",
    ]);
    expect(result.failed).toEqual([
      { name: "picture.png", message: expect.any(String) },
    ]);
    expect(
      (await service.list({ query: "evening", limit: 10 }))[0]!.title,
    ).toBe("Evening Hymn");
  });

  it("resolves a video background from the library", async () => {
    const workspace = workspaces.require();
    const asset = await workspace.media.createOrGet({
      churchId: workspace.id,
      name: "motion.mp4",
      originalName: "motion.mp4",
      mediaType: "video",
      category: "motion_background",
      mimeType: "video/mp4",
      filePath: "aa/b.mp4",
      fileSize: 1,
      checksum: "e".repeat(64),
    });
    const doc = await service.preview({
      ...draft(LYRICS),
      backgroundAssetId: asset.id,
    });
    expect(doc.slides[0]!.background).toEqual({
      type: "video",
      src: `cmp-media://asset/${asset.id}`,
      loop: true,
      muted: true,
      fit: "cover",
    });
  });
});
