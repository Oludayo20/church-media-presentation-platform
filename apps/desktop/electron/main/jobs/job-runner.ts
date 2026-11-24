import { randomUUID } from "node:crypto";
import type { Logger } from "../logging/logger";
import type {
  FromWorker,
  Job,
  JobResult,
  ToWorker,
} from "../../worker/protocol";

/** The parts of Electron's `UtilityProcess` the runner uses. */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  on(event: "message", listener: (message: FromWorker) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  kill(): boolean;
}

export interface JobProgressUpdate {
  done: number;
  total: number;
  fraction: number;
  current: string | null;
}

interface Pending {
  resolve(result: JobResult): void;
  reject(error: Error): void;
  onProgress(update: JobProgressUpdate): void;
}

/**
 * Runs jobs in the utility worker (`job:progress` events, cancellation).
 * The worker is forked on first use; if it dies, its running jobs fail and
 * the next job forks a fresh one.
 */
export class JobRunner {
  private worker: WorkerLike | null = null;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly spawn: () => WorkerLike,
    private readonly logger: Logger,
  ) {}

  start(
    job: Job,
    onProgress: (update: JobProgressUpdate) => void,
  ): { jobId: string; done: Promise<JobResult> } {
    const jobId = randomUUID();
    const done = new Promise<JobResult>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject, onProgress });
    });
    this.ensureWorker().postMessage({ type: "start", jobId, job });
    return { jobId, done };
  }

  cancel(jobId: string): boolean {
    if (!this.pending.has(jobId) || !this.worker) return false;
    this.worker.postMessage({ type: "cancel", jobId });
    return true;
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  dispose(): void {
    this.worker?.kill();
    this.worker = null;
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.spawn();
    worker.on("message", (message) => this.receive(message));
    worker.on("exit", (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (this.pending.size > 0)
        this.logger.error(`[jobs] worker exited (${code}) with jobs running`);
      for (const [id, pending] of this.pending) {
        pending.reject(new Error("The background worker stopped unexpectedly"));
        this.pending.delete(id);
      }
    });
    this.worker = worker;
    return worker;
  }

  private receive(message: FromWorker): void {
    const pending = this.pending.get(message.jobId);
    if (!pending) return;
    if (message.type === "progress") {
      pending.onProgress({
        done: message.done,
        total: message.total,
        fraction: message.fraction,
        current: message.current,
      });
      return;
    }
    this.pending.delete(message.jobId);
    if (message.type === "result") pending.resolve(message.result);
    else pending.reject(new Error(message.message));
  }
}
