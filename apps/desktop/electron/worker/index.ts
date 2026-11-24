/**
 * The utility worker (ARCHITECTURE.md §5): imports, ffprobe, thumbnails and
 * transcodes run here so a slow or malformed file can never stall the main
 * process — and so can never stall a live service.
 */
import { runBible } from "./bible";
import { runPptx } from "./pptx";
import { runImport, runSongs, runTranscode } from "./jobs";
import type { FromWorker, ToWorker } from "./protocol";

const port = process.parentPort;
const running = new Map<string, AbortController>();
const send = (message: FromWorker) => port.postMessage(message);

port.on("message", ({ data }: { data: ToWorker }) => {
  if (data.type === "cancel") {
    running.get(data.jobId)?.abort();
    return;
  }
  const { jobId, job } = data;
  const controller = new AbortController();
  running.set(jobId, controller);
  const progress = (
    update: Omit<Extract<FromWorker, { type: "progress" }>, "type" | "jobId">,
  ) => send({ type: "progress", jobId, ...update });
  const work =
    job.kind === "import"
      ? runImport(job, controller.signal, progress)
      : job.kind === "transcode"
        ? runTranscode(job, controller.signal, progress)
        : job.kind === "songs"
          ? runSongs(job, controller.signal, progress)
          : job.kind === "pptx"
            ? runPptx(job, controller.signal, progress)
            : runBible(job, controller.signal);
  work
    .then((result) => send({ type: "result", jobId, result }))
    .catch((error: unknown) =>
      send({
        type: "error",
        jobId,
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    .finally(() => running.delete(jobId));
});
