import { FontsSection } from "../fonts/FontsSection";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Input, Label } from "@cmp/design-system";
import type {
  BibleTranslation,
  AppInfo,
  WorkspaceSummary,
} from "@cmp/shared-types";
import type { Settings } from "@cmp/shared-validation";
import { useWorkspaceStore } from "../../app/stores/workspace-store";
import { errorMessage, unwrap } from "../../lib/ipc";
import { LogoPicker } from "./LogoPicker";
import { ResolutionPicker } from "./ResolutionPicker";
import { ShortcutsEditor } from "./ShortcutsEditor";
import { ThemePicker } from "./ThemePicker";

interface SettingsPageProps {
  workspace: WorkspaceSummary;
  settings: Settings;
}

export function SettingsPage({ workspace, settings }: SettingsPageProps) {
  const setSetting = useWorkspaceStore((state) => state.setSetting);

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-10">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Section title="Church">
        {/* Keyed so the field resets when the saved name changes. */}
        <ChurchNameForm
          key={workspace.churchName}
          current={workspace.churchName}
        />
        <LogoPicker logoAssetId={workspace.logoAssetId} />
      </Section>

      <Section
        title="Audience output"
        hint="The resolution slides are rendered at on the projector or screen."
      >
        <ResolutionPicker
          value={settings["display.outputResolution"]}
          onChange={(value) =>
            void setSetting("display.outputResolution", value)
          }
        />
      </Section>

      <Section title="Appearance">
        <ThemePicker
          value={settings["ui.theme"]}
          onChange={(theme) => void setSetting("ui.theme", theme)}
        />
      </Section>

      <Section
        title="Live shortcuts"
        hint="Shortcuts are ignored while you type in a field or a dialog is open."
      >
        <ShortcutsEditor bindings={settings["live.shortcuts"]} />
      </Section>

      <Section title="Bible">
        <BibleSettings settings={settings} />
      </Section>
      <Section
        title="Fonts"
        hint="Imported fonts appear in the presentation editor and on the projector."
      >
        <FontsSection />
      </Section>

      <Section title="About">
        <AboutPanel />
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function ChurchNameForm({ current }: { current: string }) {
  const renameWorkspace = useWorkspaceStore((state) => state.renameWorkspace);
  const [name, setName] = useState(current);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    try {
      await renameWorkspace(name);
      setStatus("Saved");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-1.5">
      <Label htmlFor="settings-church-name">Church name</Label>
      <div className="flex gap-2">
        <Input
          id="settings-church-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error ? true : undefined}
          maxLength={120}
        />
        <Button type="submit" disabled={name.trim() === current}>
          Save
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-live">
          {error}
        </p>
      )}
      {status && <p className="text-sm text-success">{status}</p>}
    </form>
  );
}

function AboutPanel() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    unwrap(window.cmp.app.info()).then(
      (data) => !cancelled && setInfo(data),
      (caught: unknown) => !cancelled && setError(errorMessage(caught)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-live">{error}</p>;
  if (!info) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <dl
      data-testid="app-info"
      className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm"
    >
      <dt className="text-muted">Version</dt>
      <dd>{info.version}</dd>
      <dt className="text-muted">Platform</dt>
      <dd>{info.platform}</dd>
      <dt className="text-muted">Electron</dt>
      <dd data-testid="electron-version">{info.electron}</dd>
      <dt className="text-muted">Chromium</dt>
      <dd>{info.chrome}</dd>
    </dl>
  );
}

function BibleSettings({ settings }: { settings: Settings }) {
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [error, setError] = useState("");
  const setSetting = useWorkspaceStore((state) => state.setSetting);
  useEffect(() => {
    let current = true;
    void unwrap(window.cmp.bible.translations())
      .then((items) => {
        if (current) setTranslations(items);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      });
    return () => {
      current = false;
    };
  }, []);
  const preferred = settings["bible.defaultTranslation"];
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-2">
        Default translation
        <select
          value={preferred}
          disabled={!translations.length}
          onChange={(event) =>
            void setSetting("bible.defaultTranslation", event.target.value)
          }
        >
          {!translations.some(({ code }) => code === preferred) && (
            <option value={preferred}>{preferred} (unavailable)</option>
          )}
          {translations.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings["bible.onePerSlide"]}
          onChange={(event) =>
            void setSetting("bible.onePerSlide", event.target.checked)
          }
        />{" "}
        One verse per slide
      </label>
      {error && (
        <p role="alert" className="text-live">
          {error}
        </p>
      )}
    </div>
  );
}
