import { useEffect } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, X } from "lucide-react";
import { useMediaStore } from "../media-store";
import { unwrap } from "../../../lib/ipc";

/** Progress for running imports/conversions, with cancel and a summary. */
export function ImportTray() {
  const { jobs, dismissJob, run } = useMediaStore();
  const list = Object.values(jobs);

  // Clean summaries go away by themselves; ones with failures stay.
  useEffect(() => {
    const timers = list
      .filter(
        (job) =>
          job.status === "done" &&
          job.results.every((result) => result.outcome !== "failed"),
      )
      .map((job) => setTimeout(() => dismissJob(job.jobId), 6000));
    return () => timers.forEach(clearTimeout);
  }, [list, dismissJob]);
  if (list.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="absolute bottom-4 right-4 z-30 w-80 space-y-2"
    >
      {list.map((job) => {
        const imported = job.results.filter(
          (r) => r.outcome === "imported",
        ).length;
        const duplicates = job.results.filter(
          (r) => r.outcome === "duplicate",
        ).length;
        const failed = job.results.filter((r) => r.outcome === "failed");
        const title = job.kind === "import" ? "Importing" : "Converting to MP4";
        return (
          <div
            key={job.jobId}
            data-testid="import-job"
            data-status={job.status}
            className="rounded-lg border border-border bg-surface-raised p-3 text-sm shadow-xl"
          >
            <div className="flex items-center gap-2">
              {job.status === "running" ? (
                <LoaderCircle
                  className="size-4 animate-spin text-primary"
                  aria-hidden
                />
              ) : job.status === "done" && failed.length === 0 ? (
                <CheckCircle2 className="size-4 text-success" aria-hidden />
              ) : (
                <CircleAlert className="size-4 text-warning" aria-hidden />
              )}
              <span className="flex-1 font-medium">
                {job.status === "running"
                  ? `${title} ${Math.min(job.done + 1, job.total)} of ${job.total}`
                  : job.status === "cancelled"
                    ? "Cancelled"
                    : job.status === "failed"
                      ? "Failed"
                      : "Done"}
              </span>
              {job.status === "running" ? (
                <button
                  type="button"
                  className="text-xs text-muted hover:text-foreground"
                  onClick={() =>
                    void run(() =>
                      unwrap(window.cmp.media.cancelJob({ jobId: job.jobId })),
                    )
                  }
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="text-muted hover:text-foreground"
                  onClick={() => dismissJob(job.jobId)}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {job.status === "running" && (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-border">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${Math.round(job.fraction * 100)}%` }}
                  />
                </div>
                {job.current && (
                  <p className="mt-1 truncate text-xs text-muted">
                    {job.current}
                  </p>
                )}
              </>
            )}
            {job.status !== "running" && (
              <p
                data-testid="import-summary"
                className="mt-1 text-xs text-muted"
              >
                {[
                  imported && `${imported} imported`,
                  duplicates && `${duplicates} already in library`,
                  failed.length && `${failed.length} could not be imported`,
                  job.error,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Nothing imported"}
              </p>
            )}
            {failed.length > 0 && job.status !== "running" && (
              <ul className="mt-1 max-h-24 overflow-y-auto text-xs text-warning">
                {failed.map((result) => (
                  <li key={result.name} className="truncate">
                    {result.name}: {result.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
