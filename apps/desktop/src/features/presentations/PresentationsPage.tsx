import { useEffect, useState } from "react";
import { Button } from "@cmp/design-system";
import {
  ENGINE_DOCUMENT_SCHEMA_VERSION,
  type ChannelOutput,
  type EngineDocument,
} from "@cmp/shared-validation";
import { errorMessage, unwrap } from "../../lib/ipc";
import { useLiveStore } from "../live/live-store";
import { newSlide, PresentationEditor } from "./PresentationEditor";

type Saved = ChannelOutput<"presentations:get">;

function newDocument(): EngineDocument {
  return {
    schemaVersion: ENGINE_DOCUMENT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    title: "Untitled presentation",
    width: 1920,
    height: 1080,
    slides: [newSlide()],
  };
}

export function PresentationsPage({
  initialId,
}: {
  initialId?: string | undefined;
}) {
  const [list, setList] = useState<ChannelOutput<"presentations:list">>([]);
  const [templates, setTemplates] = useState<
    ChannelOutput<"presentations:templates">
  >([]);
  const [templateId, setTemplateId] = useState("");
  const sessionId = useLiveStore((state) => state.live?.sessionId);
  const [selection, setSelection] = useState<Saved>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** What a PowerPoint/PDF import could not bring across. */
  const [report, setReport] = useState<
    { kind: string; count: number }[] | null
  >(null);

  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      unwrap(window.cmp.presentations.list()),
      initialId
        ? unwrap(window.cmp.presentations.get({ id: initialId }))
        : undefined,
      unwrap(window.cmp.presentations.templates()),
    ])
      .then(([items, selected, available]) => {
        if (!active) return;
        setList(items);
        setTemplates(available);
        if (selected) setSelection(selected);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [initialId]);

  return (
    <section className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Presentations</h1>
        {!selection && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy || Boolean(sessionId)}
              onClick={() =>
                void run(async () => {
                  const imported = await unwrap(
                    window.cmp.presentations.importDocument(),
                  );
                  if (!imported) return;
                  setSelection(imported);
                  setList(await unwrap(window.cmp.presentations.list()));
                })
              }
            >
              Import .cmppres
            </Button>
            <Button
              variant="secondary"
              disabled={busy || Boolean(sessionId)}
              onClick={() =>
                void run(async () => {
                  const imported = await unwrap(
                    window.cmp.presentations.importFile(),
                  );
                  if (!imported) return;
                  setReport(imported.report);
                  setSelection(imported.presentation);
                  setList(await unwrap(window.cmp.presentations.list()));
                })
              }
            >
              {busy ? "Importing…" : "Import PowerPoint or PDF…"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => setSelection({ version: 0, doc: newDocument() })}
            >
              New presentation
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-live">
          {error}
        </p>
      )}
      {selection && report && (
        <ImportReport report={report} onDismiss={() => setReport(null)} />
      )}
      {selection ? (
        <PresentationEditor
          key={selection.doc.id}
          initial={selection}
          existing={
            selection.version > 0 ||
            list.some(({ id }) => id === selection.doc.id)
          }
          onClose={() => {
            setSelection(undefined);
            void run(async () => {
              const [items, available] = await Promise.all([
                unwrap(window.cmp.presentations.list()),
                unwrap(window.cmp.presentations.templates()),
              ]);
              setList(items);
              setTemplates(available);
            });
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Presentation template"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="">Choose a template</option>
              {templates.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={busy || !templateId}
              onClick={() =>
                void run(async () => {
                  const doc = await unwrap(
                    window.cmp.presentations.template({ id: templateId }),
                  );
                  setSelection({
                    version: 0,
                    doc: { ...doc, id: crypto.randomUUID() },
                  });
                })
              }
            >
              Create from template
            </Button>
          </div>
          <ul className="space-y-2">
            {list.map(({ id, title }) => (
              <li key={id}>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      setSelection(
                        await unwrap(window.cmp.presentations.get({ id })),
                      ),
                    )
                  }
                >
                  {title}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The conversion report shown after a PowerPoint/PDF import. */
function ImportReport({
  report,
  onDismiss,
}: {
  report: { kind: string; count: number }[];
  onDismiss(): void;
}) {
  return (
    <div
      role="status"
      data-testid="import-report"
      className="rounded-md border border-border bg-surface p-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <p className="font-medium">
          {report.length === 0
            ? "Imported with nothing left out."
            : "Imported. Some things could not be brought across:"}
        </p>
        <button
          type="button"
          className="ml-auto text-xs text-muted underline"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
      {report.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-muted">
          {report.map((entry) => (
            <li key={entry.kind}>
              {entry.kind}
              {entry.count > 1 ? ` × ${entry.count}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
