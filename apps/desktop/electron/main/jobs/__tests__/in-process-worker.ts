import { runBible } from "../../../worker/bible";
import { runPptx } from "../../../worker/pptx";
import { runImport, runSongs, runTranscode } from "../../../worker/jobs";
import type { FromWorker, ToWorker } from "../../../worker/protocol";
import type { WorkerLike } from "../job-runner";

/** Runs the real worker job code in-process, speaking the real protocol. */
export function inProcessWorker(): WorkerLike & {
  killed: boolean;
  crash(): void;
} {
  const listeners: {
    message: ((m: FromWorker) => void)[];
    exit: ((code: number) => void)[];
  } = {
    message: [],
    exit: [],
  };
  const running = new Map<string, AbortController>();
  const emit = (message: FromWorker) =>
    queueMicrotask(() => listeners.message.forEach((l) => l(message)));
  const worker = {
    killed: false,
    postMessage(message: ToWorker) {
      if (message.type === "cancel") {
        running.get(message.jobId)?.abort();
        return;
      }
      const controller = new AbortController();
      running.set(message.jobId, controller);
      const progress = (update: {
        done: number;
        total: number;
        fraction: number;
        current: string | null;
      }) => emit({ type: "progress", jobId: message.jobId, ...update });
      const work =
        message.job.kind === "import"
          ? runImport(message.job, controller.signal, progress)
          : message.job.kind === "transcode"
            ? runTranscode(message.job, controller.signal, progress)
            : message.job.kind === "songs"
              ? runSongs(message.job, controller.signal, progress)
              : message.job.kind === "pptx"
                ? runPptx(message.job, controller.signal, progress)
                : runBible(message.job, controller.signal);
      work
        .then((result) =>
          emit({ type: "result", jobId: message.jobId, result }),
        )
        .catch((error: Error) =>
          emit({ type: "error", jobId: message.jobId, message: error.message }),
        );
    },
    on(event: "message" | "exit", listener: never) {
      (listeners[event] as unknown[]).push(listener);
      return worker;
    },
    kill() {
      worker.killed = true;
      return true;
    },
    crash() {
      listeners.exit.forEach((l) => l(1));
    },
  };
  return worker as WorkerLike & { killed: boolean; crash(): void };
}
