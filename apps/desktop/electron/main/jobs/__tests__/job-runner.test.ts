import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "../../logging/logger";
import { JobRunner } from "../job-runner";
import { inProcessWorker } from "./in-process-worker";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const noTools = { ffmpeg: null, ffprobe: null };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmp-jobs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const job = (files: string[]) => ({
  kind: "import" as const,
  files,
  mediaDir: join(dir, "media"),
  thumbsDir: join(dir, "thumbs"),
  tools: noTools,
});

describe("JobRunner", () => {
  it("forks the worker lazily, reports progress and resolves with results", async () => {
    const spawn = vi.fn(inProcessWorker);
    const runner = new JobRunner(spawn, silentLogger);
    expect(spawn).not.toHaveBeenCalled();
    writeFileSync(join(dir, "a.png"), PNG);
    writeFileSync(join(dir, "notes.txt"), "hello");
    const progress = vi.fn();
    const { done } = runner.start(
      job([join(dir, "a.png"), join(dir, "notes.txt")]),
      progress,
    );
    const result = await done;
    expect(spawn).toHaveBeenCalledOnce();
    expect(result.cancelled).toBe(false);
    expect(result.files.map((f) => f.ok)).toEqual([true, false]);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ done: 2, total: 2, fraction: 1 }),
    );
  });

  it("cancels between files and keeps what finished", async () => {
    const runner = new JobRunner(inProcessWorker, silentLogger);
    const files = Array.from({ length: 30 }, (_, i) => {
      const path = join(dir, `${i}.png`);
      writeFileSync(path, Buffer.concat([PNG, Buffer.from([i])]));
      return path;
    });
    let cancelled = false;
    const { jobId, done } = runner.start(job(files), (update) => {
      if (update.done >= 2 && !cancelled) {
        cancelled = true;
        runner.cancel(jobId);
      }
    });
    const result = await done;
    expect(result.cancelled).toBe(true);
    expect(result.files.length).toBeGreaterThanOrEqual(2);
    expect(result.files.length).toBeLessThan(30);
  });

  it("fails running jobs when the worker dies, and forks a new one next time", async () => {
    const workers: ReturnType<typeof inProcessWorker>[] = [];
    const runner = new JobRunner(() => {
      const worker = inProcessWorker();
      // Never answer: simulate a hung worker that then crashes.
      worker.postMessage = () => {};
      workers.push(worker);
      return worker;
    }, silentLogger);
    const { done } = runner.start(job([]), () => {});
    workers[0]!.crash();
    await expect(done).rejects.toThrow(/stopped unexpectedly/);
    runner.start(job([]), () => {});
    expect(workers).toHaveLength(2);
  });
});
