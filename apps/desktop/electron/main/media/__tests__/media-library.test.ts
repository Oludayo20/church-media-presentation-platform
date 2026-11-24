import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JobProgress } from "@cmp/shared-types";
import { resolveFfTools } from "@cmp/media-processing";
import { createConfigStore } from "../../config/config-store";
import { JobRunner } from "../../jobs/job-runner";
import { inProcessWorker } from "../../jobs/__tests__/in-process-worker";
import { silentLogger } from "../../logging/logger";
import {
  createWorkspaceManager,
  type WorkspaceManager,
} from "../../workspace/workspace-manager";
import { createMediaLibrary, type MediaLibrary } from "../media-library";

const CLIP = resolve(__dirname, "../../../../tests/e2e/fixtures/clip.mp4");
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9,
]);
const realTools = resolveFfTools({});

let root: string;
let workspaces: WorkspaceManager;
let library: MediaLibrary;
let events: JobProgress[];

async function setup(
  tools = { ffmpeg: null as string | null, ffprobe: null as string | null },
) {
  workspaces = createWorkspaceManager({
    workspacesDir: join(root, "workspaces"),
    backupsDir: join(root, "backups"),
    appVersion: "1",
    config: createConfigStore(join(root, "config.json"), silentLogger),
    logger: silentLogger,
  });
  await workspaces.create("Grace");
  events = [];
  library = createMediaLibrary({
    workspaces,
    jobs: new JobRunner(inProcessWorker, silentLogger),
    tools: () => tools,
    logger: silentLogger,
    pushProgress: (progress) => events.push(progress),
    pushChanged: () => {},
    chooseFiles: async () => [],
  });
}

/** Resolves when the job reaches a final status. */
function finished(jobId: string): Promise<JobProgress> {
  return new Promise((resolveDone) => {
    const timer = setInterval(() => {
      const last = events.filter((e) => e.jobId === jobId).at(-1);
      if (last && last.status !== "running") {
        clearInterval(timer);
        resolveDone(last);
      }
    }, 5);
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cmp-lib-"));
});
afterEach(() => {
  workspaces?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("media library", () => {
  it("imports, and a duplicate returns the existing asset ('Already in library')", async () => {
    await setup();
    writeFileSync(join(root, "a.png"), PNG);
    writeFileSync(join(root, "same.png"), PNG);
    const folder = await workspaces
      .require()
      .library.createFolder("Flyers", null);
    const first = await finished(
      library.import({
        paths: [join(root, "a.png")],
        folderId: folder.id,
        tags: ["harvest"],
      }),
    );
    expect(first.status).toBe("done");
    expect(first.results[0]).toMatchObject({ outcome: "imported" });
    const assetId = first.results[0]!.assetId!;
    expect(await library.get(assetId)).toMatchObject({
      folderId: folder.id,
      tags: ["harvest"],
      category: "image",
    });

    const second = await finished(
      library.import({ paths: [join(root, "same.png")] }),
    );
    expect(second.results[0]).toEqual({
      name: "same.png",
      outcome: "duplicate",
      assetId,
      message: "Already in library",
    });
  });

  it("reports unsupported files as failed without stopping the batch", async () => {
    await setup();
    writeFileSync(join(root, "a.png"), PNG);
    writeFileSync(join(root, "virus.exe"), "MZ\x90\x00");
    const result = await finished(
      library.import({ paths: [join(root, "virus.exe"), join(root, "a.png")] }),
    );
    expect(result.results.map((r) => r.outcome)).toEqual([
      "failed",
      "imported",
    ]);
  });

  it("refuses relative paths", async () => {
    await setup();
    expect(() => library.import({ paths: ["relative.png"] })).toThrow(
      /absolute/,
    );
  });

  it("blocks deleting media that is in use, and deletes files otherwise", async () => {
    await setup();
    writeFileSync(join(root, "logo.png"), PNG);
    const { results } = await finished(
      library.import({ paths: [join(root, "logo.png")] }),
    );
    const id = results[0]!.assetId!;
    const workspace = workspaces.require();
    await workspace.churches.setLogo(workspace.id, id);
    await expect(library.delete(id)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { usedBy: [expect.objectContaining({ type: "church-logo" })] },
    });
    await workspace.churches.setLogo(workspace.id, null);
    const asset = (await workspace.media.findById(id))!;
    await library.delete(id);
    expect(existsSync(join(workspace.mediaDir, asset.filePath))).toBe(false);
  });

  it("flags files that are gone or changed size, and clears the flag when they return", async () => {
    await setup();
    writeFileSync(join(root, "a.png"), PNG);
    const { results } = await finished(
      library.import({ paths: [join(root, "a.png")] }),
    );
    const workspace = workspaces.require();
    const asset = (await workspace.media.findById(results[0]!.assetId!))!;
    const stored = join(workspace.mediaDir, asset.filePath);
    rmSync(stored);
    expect(await library.scanMissing()).toEqual([asset.id]);
    expect((await library.get(asset.id)).isMissing).toBe(true);
    writeFileSync(stored, Buffer.concat([PNG, PNG]));
    expect(await library.scanMissing()).toEqual([asset.id]); // wrong size
    writeFileSync(stored, PNG);
    expect(await library.scanMissing()).toEqual([]);
    expect((await library.get(asset.id)).isMissing).toBe(false);
  });

  it.skipIf(!realTools.ffmpeg || !realTools.ffprobe)(
    "probes video, makes a poster, and transcodes into a new asset",
    async () => {
      await setup(realTools);
      const imported = await finished(library.import({ paths: [CLIP] }));
      const id = imported.results[0]!.assetId!;
      const detail = await library.get(id);
      expect(detail).toMatchObject({
        mediaType: "video",
        width: 640,
        height: 360,
        codec: "h264",
        hasAudio: true,
        hasThumbnail: true,
        transcodeReason: null,
      });
      expect(detail.durationMs).toBeGreaterThan(5000);

      const converted = await finished(await library.transcode(id));
      expect(converted.status).toBe("done");
      const copy = await library.get(converted.results[0]!.assetId!);
      expect(copy).toMatchObject({
        name: "clip (MP4)",
        mediaType: "video",
        codec: "h264",
      });
    },
    60_000,
  );
});
