import { useEffect, useState } from "react";
import { Type, Upload } from "lucide-react";
import { Button } from "@cmp/design-system";
import { errorMessage, unwrap } from "../../lib/ipc";
import { useFontsStore } from "./fonts-store";

/** Settings → Fonts: import with a licence acknowledgement, list, preview. */
export function FontsSection() {
  const { fonts, refresh } = useFontsStore();
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    return window.cmp.jobs.onProgress((progress) => {
      if (progress.status === "done") {
        void refresh();
        const failed = progress.results.filter(
          (r) => r.outcome === "failed",
        ).length;
        setStatus(
          failed ? `${failed} file(s) could not be imported` : "Fonts imported",
        );
      }
    });
  }, [refresh]);

  return (
    <div className="space-y-4">
      <ul aria-label="Imported fonts" className="space-y-1">
        {fonts.map((font) => (
          <li
            key={font.id}
            className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
          >
            <Type className="size-4 text-muted" aria-hidden />
            <span
              className="text-lg"
              style={{ fontFamily: `"${font.family}", system-ui` }}
            >
              {font.family}
            </span>
            <span className="ml-auto truncate text-xs text-muted">
              {font.name}
            </span>
          </li>
        ))}
        {fonts.length === 0 && (
          <li className="text-sm text-muted">
            No fonts imported yet. Text uses built-in fonts.
          </li>
        )}
      </ul>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>
          Our church holds a licence that allows these fonts to be{" "}
          <strong>projected</strong> in services (and streamed, if we stream).
          Many desktop font licences do not cover this.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          disabled={!acknowledged}
          onClick={async () => {
            setStatus(null);
            try {
              const { jobId } = await unwrap(
                window.cmp.fonts.import({ acknowledged: true }),
              );
              if (jobId) setStatus("Importing…");
            } catch (error) {
              setStatus(errorMessage(error));
            }
          }}
        >
          <Upload className="size-4" aria-hidden />
          Import fonts…
        </Button>
        {status && (
          <output className="text-sm text-muted" data-testid="fonts-status">
            {status}
          </output>
        )}
      </div>
    </div>
  );
}
