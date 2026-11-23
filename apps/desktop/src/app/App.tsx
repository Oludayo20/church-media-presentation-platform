import { Button } from "@cmp/design-system";
import { useAppInfo } from "./hooks/useAppInfo";

const MODULES = [
  "Home",
  "Live",
  "Services",
  "Presentations",
  "Songs",
  "Bible",
  "Media Library",
  "Templates",
  "Downloads",
  "Settings",
] as const;

/**
 * Phase 0 placeholder shell: proves the renderer, Tailwind tokens, design
 * system and typed preload bridge all work end to end. The real navigation
 * shell arrives in Phase 1 (docs/TASKS.md).
 */
export function App() {
  const appInfo = useAppInfo();

  return (
    <div className="flex h-screen">
      <nav
        aria-label="Modules"
        className="w-56 shrink-0 border-r border-border bg-surface p-3"
      >
        <p className="px-2 pb-3 text-sm font-semibold tracking-wide">
          Church Media
        </p>
        <ul className="space-y-1">
          {MODULES.map((name) => (
            <li key={name}>
              <span className="block rounded-md px-2 py-1.5 text-sm text-muted">
                {name}
              </span>
            </li>
          ))}
        </ul>
      </nav>

      <main className="flex flex-1 flex-col items-start gap-6 p-10">
        <div>
          <h1 className="text-2xl font-semibold">Church Media</h1>
          <p className="mt-1 text-muted">
            Worship presentation workspace — Phase 0 tooling scaffold.
          </p>
        </div>

        <section
          aria-label="Environment"
          data-testid="app-info"
          className="rounded-md border border-border bg-surface-raised p-4 text-sm"
        >
          {appInfo.status === "loading" && <p>Connecting to main process…</p>}
          {appInfo.status === "error" && (
            <p className="text-live">IPC error: {appInfo.message}</p>
          )}
          {appInfo.status === "ready" && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
              <dt className="text-muted">Version</dt>
              <dd>{appInfo.info.version}</dd>
              <dt className="text-muted">Platform</dt>
              <dd>{appInfo.info.platform}</dd>
              <dt className="text-muted">Electron</dt>
              <dd data-testid="electron-version">{appInfo.info.electron}</dd>
              <dt className="text-muted">Chromium</dt>
              <dd>{appInfo.info.chrome}</dd>
            </dl>
          )}
        </section>

        <div className="flex gap-3">
          <Button disabled>Start live presentation</Button>
          <Button variant="secondary" disabled>
            Create service
          </Button>
        </div>
      </main>
    </div>
  );
}
