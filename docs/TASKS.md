# Task Breakdown

This is the implementation plan for the platform described in [`ARCHITECTURE.md`](ARCHITECTURE.md), ordered by dependency. Each phase can be shipped and demoed on its own before the next one starts.

The live presentation engine is the riskiest component, so it comes immediately after the foundation (Phases 2–3). That follows the PRD's direction: _"Build the presentation engine before building the complete dashboard."_

Legend: 🟦 infra · 🟪 backend (main process / repositories) · 🟩 worker · 🟨 frontend · ⬜ cross-cutting

Rough schedule (small experienced team): Phases 0–9 ≈ 14 weeks to MVP, and Phases 10–12 overlap the last 2–3 weeks.

---

## Phase 0 — Repo & Tooling

- [x] 🟦 pnpm workspace + Turborepo with `apps/desktop`, `apps/api` (empty), and `packages/{presentation-engine,database,shared-types,shared-validation,media-processing,import-export,design-system}`. See [ARCHITECTURE.md §11](ARCHITECTURE.md#11-suggested-repository-layout).
- [x] 🟦 electron-vite set up for main, preload and two renderer entries (`index.html` operator, `audience.html`).
- [x] ⬜ TypeScript strict, ESLint (flat config), Prettier, `dependency-cruiser` rules (engine must not import React; renderer must not import Node). See [DOCUMENTATION.md §16](DOCUMENTATION.md#16-repository-layout).
- [x] ⬜ Vitest workspace config and Playwright-Electron harness that launches the built app.
- [ ] 🟦 GitHub Actions: lint, typecheck, unit tests on ubuntu/macos/windows. Unsigned build artifacts per PR. _(Workflow written at `.github/workflows/ci.yml`; it has not run yet because the repo has no GitHub remote. Tick this after the first green run.)_
- [x] ⬜ Tailwind + shadcn/ui in `packages/design-system`, dark-first tokens.

> **Done.** The repo is a pnpm 12 workspace orchestrated by Turborepo (`turbo.json` runs `typecheck`/`build` in dependency order). Tooling follows the sibling-repo conventions: a shared `packages/config/tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), a single root `vitest.config.ts` running colocated `__tests__/*.test.ts(x)`, a single root ESLint 9 flat config (`eslint.config.mjs`: typescript-eslint + react-hooks + prettier), and Prettier with the house settings. It diverges from the siblings in two places, both because the docs chose them: **pnpm + Turborepo** instead of npm workspaces, and workspace packages export their **TypeScript source** (`"exports": "./src/index.ts"`) instead of a compiled `dist/`, because electron-vite bundles them. TypeScript is pinned to **6.0.x** because typescript-eslint does not support TS 7 yet.
>
> **Packages.**
>
> - `@cmp/shared-types`: the `IpcResult` envelope, `ERROR_CODES`, the `ok()`/`fail()` helpers, `AppInfo`, and the `CmpApi` preload-surface type. The type lives here so the sandboxed renderer never imports Electron.
> - `@cmp/shared-validation`: Zod 4 `ipcResultSchema()`, plus the `ipcChannels` registry that pairs each channel's input and output schemas. For now it holds one channel, `app:info`.
> - `@cmp/presentation-engine`: the React-free `createOutputSurface()` (a black, cursorless stage) that the audience entry mounts.
> - `@cmp/design-system`: dark-default and light token sets in CSS variables mapped through Tailwind v4 `@theme inline`, plus `cn()`, a shadcn-style `Button` (cva) with a `live` variant, and `components.json`.
> - `database`, `media-processing` and `import-export` are intentionally empty, each with a header pointing to the phase that fills it.
>
> **Desktop app (`apps/desktop`).** The electron-vite 6 / Vite 8 config builds main, a CommonJS preload (required by `sandbox: true`), and two renderer entries. `audience.html` boots the engine with no React. A small `transformIndexHtml` plugin injects the strict production CSP from DOCUMENTATION.md §2.1, and a relaxed CSP only under the dev server. Some Phase 1 security work landed early because the smoke test needed it:
>
> - `createSecureWindow()` (contextIsolation, sandbox, no nodeIntegration, no webview).
> - `hardenApp()`: every `window.open` denied, `will-navigate`/`will-redirect` blocked outside the bundle via the pure, unit-tested `isAppUrl()`, all permission requests denied.
> - A single-instance lock.
> - A first `handle()` IPC helper that rejects untrusted sender frames, Zod-validates the payload and always returns the envelope. It serves `app:info` over `window.cmp`.
>
> Every app dependency is a devDependency because all of it is bundled. The unsigned asar therefore contains only `out/` and `package.json`.
>
> **Dependency rules** (`.dependency-cruiser.cjs`): engine-no-react, packages-not-import-apps, renderer-no-node-builtins, renderer-no-electron-or-main-code, browser-packages-no-node, database-main-process-only, shared-types-is-a-leaf, not-to-unresolvable, and no-circular. pnpm install scripts are deny-by-default (`allowBuilds` in `pnpm-workspace.yaml`).
>
> **Verified for real (macOS arm64, Electron 45.4.1):**
>
> - `pnpm check` is green: lint, format, typecheck of 8 packages, depcruise, and 18 unit tests in 5 files.
> - `pnpm test:e2e` passes 6/6 against the production build: the window opens; `app:info` round-trips through preload and IPC; `window.require`/`window.process` are undefined and `window.cmp` exposes only `app`; `window.open` is denied; navigation to an external URL is blocked; the strict CSP is present and nothing violated it.
> - The navigation test was confirmed to **fail** with the guard disabled, then the guard was restored.
> - Each dependency rule was confirmed to fire on a deliberately planted violation (Node built-in, electron and an undeclared package in the renderer; react in the engine).
> - `pnpm dist:dir` produced an unsigned `Church Media.app` (259 MB), which launched and passed the IPC round trip.
> - `pnpm dev` ran with HMR, and the renderer was checked over CDP: IPC works and there are no console errors under the dev CSP.
>
> **Not verified:** the CI workflow (no remote yet); Windows and Linux builds and e2e (the Linux job uses `xvfb-run`); a projector or second display (not needed until Phase 2).

## Phase 1 — Foundation: shell, IPC, database, workspace

- [x] 🟪 Main process lifecycle: single-instance lock, `app.whenReady`, window-state persistence, electron-log.
- [x] 🟪 Hardened `BrowserWindow` factory (contextIsolation, sandbox, CSP, navigation and new-window blocking). See [DOCUMENTATION.md §2.1](DOCUMENTATION.md#21-window-security-configuration). _(Landed early in Phase 0: `createSecureWindow()` + `hardenApp()`, covered by e2e.)_
- [x] 🟪 IPC router with a Zod schema registry, `IpcResult` envelope and error codes, plus a test asserting that every channel has a schema. See [DOCUMENTATION.md §2.2–2.3](DOCUMENTATION.md#22-preload-api-surface).
- [x] 🟪 Typed preload bridge `window.cmp` generated from the shared channel map.
- [x] 🟪 `packages/database`: Drizzle schema for workspace, users, settings, presentations, slides and slide_objects. WAL pragmas, migration runner, pre-migration backup hook. See [DOCUMENTATION.md §9.2](DOCUMENTATION.md#92-migrations).
- [x] 🟪 Repository pattern + `settings` repository with typed keys. See [DOCUMENTATION.md §13](DOCUMENTATION.md#13-filesystem--settings-key-catalog).
- [x] 🟪 `cmp-media://` privileged protocol with path confinement and Range support.
- [x] 🟨 App shell: sidebar navigation (Home, Live, Services, Presentations, Songs, Bible, Media, Templates, Downloads, Settings), theme switch, offline indicator.
- [x] 🟨 First-launch onboarding: church name, logo, output resolution, theme. See [DOCUMENTATION.md §17.3](DOCUMENTATION.md#173-onboarding-journey-1).
- [x] ⬜ Tests: repository unit tests on an in-memory SQLite, and an IPC validation rejection test.

> **Done.** Verified on macOS arm64 (Electron 45.4.1): `pnpm check` is green (lint, format, typecheck of 8 packages, depcruise, **111 unit tests in 16 files**), and `pnpm test:e2e` passes **11/11** against the production build.
>
> **Database (`@cmp/database`).**
>
> - **Driver change:** Node's built-in `node:sqlite` replaces better-sqlite3, driven through `drizzle-orm/sqlite-proxy`. There is no native module, no ABI rebuild and no install script. See ARCHITECTURE.md §2.5.
> - **Schema:** churches, users, church_members, settings, presentations, slides and slide_objects, with CHECK constraints and §12 indexes. `media_folders`/`media_assets` were pulled forward from Phase 4 for the logo and `cmp-media://`.
> - **No deferrable UNIQUE:** SQLite cannot make a UNIQUE constraint DEFERRABLE, so `slides(presentation_id, position)` is a plain unique index and reorders must write positions in two passes.
> - **Pragmas:** WAL, `foreign_keys`, `synchronous=NORMAL`, `busy_timeout`.
> - **Migration runner:** it owns `app_migrations` and applies all pending migrations in one transaction, with foreign keys off, then `foreign_key_check`, rolling back on failure. It refuses databases written by a newer app (`WorkspaceTooNewError`).
> - **Pre-migration backup:** before upgrading an existing database, a hook snapshots it with SQLite's online backup to `backups/pre-migrate-<version>-<ts>.db`. It is db-only for now; Phase 9 wraps it as `.cmpbackup`.
> - **Generating migrations:** `pnpm --filter @cmp/database db:generate` runs drizzle-kit and embeds the SQL into `src/migrations.generated.ts`. A test fails if the two drift.
> - **Repositories:** workspace (church plus Owner), media (dedupe on checksum) and settings. The settings catalogue is typed and injected, so the package needs no Zod.
>
> **IPC.**
>
> - **Layout:** `@cmp/shared-validation` holds `src/ipc/*.ts`, the channel registry and the §13 settings catalogue (with Zod defaults, plus `onboarding.completedAt`; `live.shortcuts` arrives in Phase 3).
> - **Bridge:** `CmpApi` is derived from the registry, and the preload builds `window.cmp` from a Zod-free channel-name list.
> - **Router (`electron/main/ipc/router.ts`):** it rejects untrusted frames, validates input (`VALIDATION_ERROR` with the issues), maps `AppError` to its code, hides other errors behind `INTERNAL`, and validates output.
> - **Startup check:** the router throws if the handler set and the registry differ, and handlers are built from injected dependencies, so tests cover the real set.
> - **Mutation-checked:** removing input validation fails the router tests.
>
> **Main process.**
>
> - **Lifecycle:** single-instance lock (per userData), electron-log (`logs/main.log` and `renderer.log`, 5 × 5 MB rotation, crash and event logging), and startup dialogs for a failed or too-new migration.
> - **`config.json`:** atomic writes; a corrupt file is moved aside. It holds the active workspace and window state.
> - **Window state:** restored only if it is visible on a connected display, otherwise re-centred.
> - **userData isolation:** unpackaged builds use `CMP_USER_DATA_DIR` (e2e) or a separate "(dev)" folder.
> - **`ui.theme`:** mirrored into `nativeTheme`.
> - **`cmp-media://asset/<ulid>`:** resolves through the database only. It confines paths after `realpath` (blocking traversal, absolute paths and symlinks out), serves Range/206/416 for seeking, and allows GET/HEAD only. Mutation-checked.
> - **CSP:** renderer `fetch()` of the scheme stays blocked; only `<img>`/`<video>` may load it.
>
> **Renderer.**
>
> - **Onboarding:** three steps (church name, logo via a native dialog in main, output resolution and theme). Step 1 creates the workspace, so a restart resumes at step 2.
> - **App shell:** sidebar with the 10 modules, logo, three-way theme switch and offline indicator. Unbuilt modules show placeholders naming their phase.
> - **Pages:** Home shows the church and the output resolution. Settings covers name, logo, output, theme and About.
> - **State:** Zustand stores; every change round-trips through IPC.
>
> **E2E (`tests/e2e/`).** Every launch gets a temporary userData directory.
>
> - Security checks from Phase 0.
> - Validation rejection, and `NOT_FOUND` before a workspace exists.
> - The full Journey 1 (logo decoded over `cmp-media://`).
> - Restart persistence: workspace, theme, logo and window bounds.
> - Protocol Range and confinement via `net.fetch`.
> - The offline indicator.
>
> **Not done / not verified.**
>
> - Journey 1's Bible translation, sample pack, display test and tour belong to later phases.
> - Windows/Linux e2e (CI not run yet).
> - A packaged (`dist:dir`) launch with a real workspace, to avoid writing into the real userData folder.

## Phase 2 — Display Manager & Presentation Engine prototype (first milestone)

Goal: prove the six things in the PRD. Projector detected, separate fullscreen audience window, text and images rendered, local 1080p video plays smoothly, operator controls the output, and it all works offline.

- [x] 🟪 Display Manager: enumerate, identify overlay, assign, `display_profiles` fingerprinting, test pattern. See [DOCUMENTATION.md §4.1](DOCUMENTATION.md#41-detection--selection).
- [x] 🟪 Audience window placement (frameless fullscreen, black background, `ready-to-show`, macOS `simpleFullscreen`). See [DOCUMENTATION.md §4.2](DOCUMENTATION.md#42-audience-window-placement).
- [x] 🟪 `MessageChannelMain` audience port and the sequence-numbered `EngineCommand` protocol. See [DOCUMENTATION.md §2.4](DOCUMENTATION.md#24-audience-channel).
- [x] 🟪 `presentation-engine`: `PresentationLoader` (Zod + schema versioning), `SlideRenderer` (Text, Image, Video), `OutputController` (letterbox scaling, safe areas). See [DOCUMENTATION.md §3.3](DOCUMENTATION.md#33-engine-internals).
- [x] 🟪 Double-buffered front/back layers, image `decode()` before swap, video first-frame preload, background-video continuity across slides.
- [x] 🟪 `TransitionManager`: cut and fade.
- [x] 🟪 Media failure → fallback background + `engine:state` warning.
- [x] 🟨 Minimal operator test page: load a hard-coded deck, next/prev, black screen, display picker.
- [x] ⬜ Engine unit tests (jsdom) for command idempotency (`seq`), goto bounds and fallback behaviour.
- [ ] ⬜ Hardware smoke test on a real projector: laptop + HDMI projector, and desktop + LED wall over HDMI. Record slide-switch latency.
      _How to run it: connect the projector, open Live, Identify, press **Use** on it, turn on the test pattern and check overscan and the safe area, then **Add test media** with a 1080p MP4. Go live, step through about 30 slides with a clicker, and unplug and replug the HDMI cable once. Record slide-switch latency from a slow-motion phone video of the key press and the projector, and note anything odd in `logs/main.log`._

## Phase 3 — Live Control & hot-plug recovery

- [x] 🟪 `LiveSessionController`: state machine (idle → preparing → live ↔ masked/overlay/suspended → ended), `live_sessions` journal with 250 ms debounce. See [DOCUMENTATION.md §3.1](DOCUMENTATION.md#31-session-state-machine).
- [x] 🟪 Live commands: next, prev, goto, item next/goto, blank, logo, clear, video transport (play/pause/stop/seek/volume/mute).
- [x] 🟪 Overlay stack (`overlayPush`/`overlayPop`) with snapshot and restore of item, slide and video time.
- [x] 🟪 Hot-plug handling: suspend on removal, auto-restore on fingerprint match, prompt on unknown display, metrics change rescale. See [DOCUMENTATION.md §4.3](DOCUMENTATION.md#43-hot-plug).
- [x] 🟪 Single-display preview mode.
- [x] 🟨 Live workspace UI: current, audience mirror and next previews (embedding the engine in preview mode), playlist, thumbnails, transport bar, always-visible BLACK/LOGO/CLEAR, display status chip, disconnection banner. See [DOCUMENTATION.md §3.4](DOCUMENTATION.md#34-operator-live-workspace).
- [x] 🟨 Keyboard shortcut layer with focus guards and remapping UI. Works with PageUp/PageDown clickers. See [DOCUMENTATION.md §3.5](DOCUMENTATION.md#35-keyboard-shortcuts-defaults-configurable).
- [x] ⬜ E2E: start session → advance 20 slides → unplug the simulated display → re-add it → assert the same slide is shown.

> **Done, except the hardware smoke test**, which needs a real projector; this machine has one built-in display. Verified on macOS arm64 (Electron 45.4.1): `pnpm check` is green with **175 unit tests in 20 files**, and `pnpm test:e2e` passes **14/14**. The live suite passed three repeated runs.
>
> **Engine (`@cmp/presentation-engine`, React-free).**
>
> - **Planes.** Each document level (base plus one per overlay) is a `Deck` with a background plane under a content plane. Each plane is double-buffered (front/back) and is its own stacking context.
> - **Shared backgrounds.** A background whose key is unchanged is never touched, so a motion background plays on across lyric slides and even across items.
> - **Pre-rendering.** The next slide is pre-rendered (image `decode()`, video first frame) once the current fade has finished, because during a fade the back layer is still the outgoing picture. A slide about to be shown settles the fade first.
> - **Transitions and media.** Cut and fade are supported. Media errors show the fallback colour and raise a `MEDIA_FAILED` warning.
> - **Output.** Content is letterboxed to the output. The test pattern shows a grid, the safe area, colour bars, a sample lyric and the resolution. The logo screen falls back to the church name. Preview engines are always muted.
> - **Commands.** The protocol is Zod-validated: a document may only reference `cmp-media://asset/<ulid>` or inline images. Commands are idempotent by `seq`, and stale `goto`s are coalesced.
> - **Main-process modules (`electron/main`).** `displays/` holds the injectable screen source, a fake screen for e2e, fingerprinting and the `DisplayManager`. `live/` holds `LiveSessionController`, `AudienceOutput`, `EnginePort` and the runtime.
>
> **Main process.**
>
> - **Displays.** `display_profiles` rows are matched by `sha256(label|physical size|scaleFactor)`. On start-up, the most recent remembered non-primary display is re-assigned automatically. An unknown display produces the "Use as audience screen?" toast. "Identify" shows a large number on every display.
> - **Audience window.** Frameless and black, shown inactive after `ready-to-show`, never focusable or throttled, and allowed to autoplay with sound. macOS uses `simpleFullscreen`.
> - **Live session.** The model is authoritative and its status is derived: idle, preparing, live, masked, overlay or suspended. "Next" rolls into the next item, and "previous" into the previous item's last slide. Overlays snapshot the video underneath. Item changes reset CLEAR but keep BLACK.
> - **Journal.** `live_sessions` is written debounced at 250 ms, flushed on item and overlay changes, with a 10 s heartbeat. The resume prompt is Phase 9.
> - **Hot-plug.** Unplugging closes the audience window and suspends the session. Replugging the same fingerprint (even under a new OS id) recreates the window and replays it to the exact slide, mask, overlay and video position. A metrics change moves the window without a reload. With no external display, the in-app mirror is the output (preview mode).
>
> **Content.** Services, songs and scripture arrive in Phases 5–8. Until then, the live session runs a built-in demo playlist (`live/demo-playlist.ts`) with placeholder text: welcome, two songs, a reading, test media and announcements, 24+ slides in all.
>
> - **Test media.** "Add test media" imports an image or MP4/MOV/WebM video into the test deck (media category `test-deck`) for the hardware check.
> - **Import pipeline.** The Phase 1 import grew a streamed SHA-256 plus copy and video magic bytes. ffprobe and transcoding remain Phase 4.
>
> **Operator UI.**
>
> - **Live setup:** displays, Identify, test pattern, add test media, and Go live (labelled "preview only" without a projector).
> - **Live workspace:** status, display chip, BLACK/LOGO/CLEAR and End always visible; the disconnect banner with "Continue in preview"; the playlist with overlay buttons; the audience mirror (a real engine on a mirror port), current and next previews, the video transport and the thumbnail strip.
> - **Shortcuts:** the defaults from §3.5, ignored in text fields and dialogs. PageUp/PageDown clickers work, as do number-then-Enter and Esc (closes an overlay, or confirms ending). Shortcuts are remappable in Settings → Live shortcuts (the `live.shortcuts` setting).
>
> **IPC.**
>
> - **Channels:** `displays:*` and `live:*` are added (33 channels in all).
> - **Push events:** `live:state` and `displays:changed`, exposed as `window.cmp.live.onState()` / `window.cmp.displays.onChanged()` and typed from an event registry.
> - **Engine ports:** these reach pages through the preload with `window.postMessage`, and are accepted only from the page's own window.
>
> **E2E (`tests/e2e/live.e2e.ts`, simulated projector via `CMP_FAKE_DISPLAYS=1`, unpackaged builds only):**
>
> - **The Phase 3 acceptance test.** Go live, advance 20 slides with PageDown/→, unplug, check the banner, the `suspended` status and that the audience window is gone, then replug under a new id. The same slide comes back, with the text verified on top through real layout.
> - **Video and controls.** The fixture MP4 really plays on the audience window (sound on; mirror muted), and the test pattern shows the safe area. BLACK works by key and LOGO by button. An overlay is pushed over the playing video, then Esc returns to it.
> - **Preview mode.** Single-display preview mode with item navigation and number-then-Enter.
>
> **Bugs found by looking, then pinned by tests.**
>
> - **Hidden text:** the background layer painted over the text. A stacking-context fix, mutation-checked by an e2e layout assertion.
> - **Mid-fade pre-render:** pre-rendering during a fade wiped the incoming slide. Mutation-checked by two engine tests.
>
> **Not done / not verified.**
>
> - **Hardware:** the real-projector smoke test and latency numbers (below), Windows/Linux fullscreen behaviour, and real HDMI hot-plug events (the logic is tested through the fake screen).
> - **Performance:** with the mirror, previews and thumbnails, an operator laptop decodes the video more than once. The thumbnails are static, but the mirror plays. Check this on the 4-year-old i5 target in Phase 10.
> - **Quick Scripture:** Ctrl/Cmd+F is reserved and does nothing until Phase 6.

## Phase 4 — Media Library

- [x] 🟪 Schema: `media_assets`, `media_folders`, `media_tags`, `media_asset_tags`, `media_licences`.
- [x] 🟩 `utilityProcess` job runner with `job:progress` events and cancellation.
- [x] 🟩 Import pipeline: magic-byte validation, streamed SHA-256, dedupe, atomic copy, ffprobe, thumbnail/poster, GIF→MP4 offer, transcode offer for unsupported codecs. See [DOCUMENTATION.md §7](DOCUMENTATION.md#7-media-import-pipeline).
- [ ] 🟩 Bundle ffmpeg/ffprobe static binaries per platform (licence check: LGPL build).
      _Open decision: **which binaries to ship**. Everything else is wired: `resources/ffmpeg/<os>-<arch>/` is copied by `electron-builder.yml` `extraResources`, the app resolves bundled, then `CMP_FFMPEG_PATH`/`CMP_FFPROBE_PATH`, then `PATH`, and packaging is verified to work with the folder empty. LGPL builds for Windows and Linux are widely published. The common macOS static builds are GPL, so macOS probably needs an LGPL build of our own (`--disable-gpl --enable-libwebp`, no libx264). Choosing the source and doing the licence review is yours. Note also that **conversion to H.264 uses libx264, which is GPL**: an LGPL bundle must either convert with the OS encoder (`h264_videotoolbox` on macOS, `h264_mf` on Windows) or drop the "Convert to MP4" offer. See resources/ffmpeg/README.md._
- [x] 🟪 Missing-file scan at startup and on demand. Deleting a referenced asset is blocked with `usedBy`.
- [x] 🟨 Library UI: grid/list, folders, tags, categories, favourites, search, drag-and-drop, hover video preview, file size, missing badges.
- [x] ⬜ Tests: duplicate import returns the existing asset, interrupted copy leaves no partial file, path traversal rejected by `cmp-media://`.

> **Done, except choosing the ffmpeg binaries to bundle** (above). Verified on macOS arm64 (Electron 45.4.1, Homebrew ffmpeg on `PATH`): `pnpm check` is green with **218 unit tests in 24 files**, `pnpm test:e2e` passes **15/15**, and `pnpm dist:dir` still packages, with `worker.js` in the asar.
>
> **Schema (migration `0002_media_library`).** Adds `media_tags`, `media_asset_tags`, `media_licences` (owned, licensed, public domain, Creative Commons, unknown), and `media_assets.has_audio` / `transcode_reason` / `playback_warning`. `media-library-repository` provides:
>
> - filtered, cursor-paged listing (folder or unfiled, type, category, tag, escaped name search, favourites, missing);
> - folders: deleting one moves its assets to Unfiled;
> - tags: deduped, with unused ones pruned;
> - licences and missing flags;
> - `usage()`: church logo, logo screen, slide backgrounds and slide objects.
>
> **Pipeline (`@cmp/media-processing`, DB-free).**
>
> - Magic-byte sniffing for the full §7 list. SVG and non-WebM Matroska are refused.
> - A streamed SHA-256 computed while copying, then fsync and atomic rename. Cancelling or interrupting leaves no partial file.
> - Per-type size limits.
> - ffprobe parsing, ignoring audio cover art.
> - Playback advice: unplayable codecs and GIFs over 5 MB get a "Convert" offer; HEVC gets a warning.
> - 320 px WebP/JPEG thumbnails, and posters taken at 10% of the duration.
> - H.264/AAC MP4 transcoding with progress.
> - Commands are spawned without a shell and can be killed on cancel.
>
> **Worker.** `electron/worker` is a second main-build entry, forked with `utilityProcess` on first use. `JobRunner` fails running jobs if the worker dies and forks a fresh one next time. `job:progress` reaches the UI as the `jobs:progress` push event, and cancellation is supported.
>
> **Library UI.**
>
> - Sidebar: All, Favourites, Missing, types, folders (create, delete), tags with counts.
> - Grid and list views, with debounced search and "Load more" paging.
> - Cards show posters/thumbnails over `cmp-media://thumb`, a duration badge, file size and dimensions, Missing and Convert badges, a favourite star, and a muted hover preview for video.
> - Drag-and-drop anywhere on the library, plus an Import button (native multi-select).
> - The import tray shows progress, cancel and a per-file summary. Clean summaries auto-dismiss.
> - The detail panel has a preview, metadata, rename, category, folder, tags, licence, "Used by", Convert to MP4, the HEVC warning, and delete. A blocked delete explains what still uses the asset.
>
> **Tests.**
>
> - Unit: sniffing table, store dedupe/cancel/no partial file, probe parsing, advice, the tool resolver; the job runner (lazy fork, progress, cancel, crash recovery); the library service end to end through the real worker code in-process; the protocol's thumb route.
> - ffmpeg-dependent tests are skipped automatically where ffmpeg is absent (`describe.skipIf`), so CI runners without it stay green.
> - e2e `media.e2e.ts`: import of video, image and an unsupported file; "Already in library"; poster decoded over `cmp-media://thumb`; the hover preview actually playing; search, tags and favourites; delete blocked because the image is the church logo; a file removed on disk shows Missing after "Check files"; delete; list view; the drop zone.
> - The Phase 1 tests for duplicate import, partial-file safety and `cmp-media://` traversal still pass.
>
> **Found by e2e and fixed:** the finished-import tray sat on top of the detail panel's Delete button. It now lives inside the library pane and dismisses itself when clean.
>
> **Not done / not verified.**
>
> - The ffmpeg bundle (above). The packaged worker is built but was not launched with a real workspace.
> - The optional 3 s hover-preview strip.
> - Real OS drag-and-drop: e2e cannot synthesise file paths, so it covers the drop zone and `media:import` separately.
> - Library assets cannot yet be placed on slides; that is the Phase 7 editor.

## Phase 5 — Song Manager

- [x] 🟪 Schema: `songs`, `song_sections`, `song_arrangements`, `song_collections`, `songs_fts` (unicode61 with diacritics removed).
- [x] 🟪 Lyrics parser (section headers, stanzas) and lyrics-to-slides generator with line/char split and measured auto-fit. See [DOCUMENTATION.md §5.2](DOCUMENTATION.md#52-algorithm).
- [x] 🟪 `songs:search` with weighted bm25 ranking.
- [x] 🟪 Song file importers: plain text, OpenLyrics XML, CCLI SongSelect text/USR.
- [x] 🟪 Live lyric edit → slide diff → `live:patch`. See [DOCUMENTATION.md §3.6](DOCUMENTATION.md#36-live-edits).
- [x] 🟨 Song editor: sections, arrangement builder (drag chips such as `V1 C V2 C B C`), split settings, background and template picker, generated slide preview, copyright fields.
- [x] 🟨 Collections (Praise, Worship, Hymns, Communion, Christmas, Easter, Nigerian gospel).
- [x] ⬜ Tests: parser fixtures (including Yoruba/Igbo diacritics), split and fit edge cases, search ranking.

> **Done.** Verified on macOS arm64 (Electron 45.4.1): `pnpm check` is green with **276 unit tests in 29 files**, and `pnpm test:e2e` passes **16/16**.
>
> **Data (migrations `0003_songs`, `0004_songs_fts`).**
>
> - **Tables:** `songs` (plus `tags_json`, a per-song `split_json`, and a `template_id` holding a built-in layout until Phase 7), `song_sections`, `song_arrangements` (the default arrangement holds section ids, repeats allowed), `song_collections` and `song_collection_items`.
> - **Search:** `songs_fts` uses FTS5 with `unicode61 remove_diacritics 2`. "olorun" finds "Ọlọ́run" and "anyi" finds "anyị", for both precomposed and decomposed input.
> - **Repository:** each write replaces sections, arrangement, collection links and the FTS row in one transaction. Search is ranked by weighted bm25 (title ≫ artist > tags > lyrics), with prefix matching, every word required, `«snippets»`, and quoting that makes FTS operators typed by users harmless.
> - **Collections:** the seven built-ins (Praise, Worship, Hymns, Communion, Christmas, Easter, Nigerian gospel) are seeded once per workspace.
> - **Media guard:** media deletion is now also blocked while a song uses the asset as its background.
>
> **Pipeline (`@cmp/import-export`, pure TypeScript).**
>
> - **Parser.** Recognises `Verse 1:`, `[Chorus]`, `V2`, `PC`, `Tag x2` and the like. Blank lines become stanzas, and a repeated header reuses its section. Without headers, a word-for-word repeated stanza becomes the chorus.
> - **Split.** By lines or by a character budget, never mid-line and never across stanzas.
> - **Fit.** Shrinks towards the minimum size, then splits the chunk again.
> - **Generator.** Stable slide ids, section labels in `meta`, a copyright footer on the first and last slide (the `songs.showCopyright` setting), optional blank slides between sections, and three layouts.
> - **Importers.** Plain text, CCLI SongSelect `.txt` and `.usr`, and OpenLyrics XML (chords and comments dropped, `verseOrder` honoured, DOCTYPE/ENTITY refused). They run in the utility worker.
> - **Measurement.** It is an estimate in the main process, not canvas, so preview and projector match; see DOCUMENTATION.md §5.3.
>
> **Live.**
>
> - `live:queueSong` adds a song to the running session; the quick panel's "Add song" uses it.
> - "Edit lyrics" in the live top bar calls `songs:update`. Main regenerates the song and diffs it: same slide ids means only the changed slides are sent as `patch` (text swapped in place, video untouched). A structural change reloads the item at the nearest slide and re-pushes overlays.
> - Item revisions refresh the operator previews.
> - The thumbnail strip is grouped by section ("Chorus").
>
> **UI.**
>
> - Songs module: search (titles and lyrics with snippets), collection filter, new song, and import (picker, multi-file).
> - Editor: title; artist, language (English, Yorùbá, Igbo, Hausa, Pidgin, French), tags, copyright owner and year, CCLI number; collection chips; sections (type, name, lyrics, add, remove).
> - Paste lyrics: parses pasted text into sections.
> - Arrangement builder: drag-to-reorder chips (`V1 C V2 C`), click to append, × to remove.
> - Slide settings: workspace default or custom lines/characters, blank-between-sections, layout, and a background picker from the media library.
> - A live preview grouped by section, generated by main exactly as the projector will show it. "Add to live" appears while a session runs.
>
> **Tests.**
>
> - Parser fixtures, including Yoruba/Igbo diacritics and Windows line endings.
> - Split and fit edge cases: stanza boundaries, character budget, impossible lines, repeated splits.
> - Generator: arrangement, ids stable under edits, footer, blank slides, upper-case layout.
> - Importers: every format, XXE refusal, BOM, oversize files.
> - Repository: round-trip, ranking, diacritics, operator injection, collections, media usage.
> - Controller: patch-only and reload-with-overlays.
> - Song service end to end through the in-process worker, including a live patch that sends exactly one `patch`.
> - e2e `songs.e2e.ts`: paste → chips → grouped preview → collection → save; Yoruba file import and diacritic-free search; snippets; collection filter; live add song, jump to chorus, fix the lyric; the mirror updates on the same slide, and both chorus occurrences change.
>
> **Not done.** Templates beyond the three built-in layouts (Phase 7). Multiple named arrangements (the schema supports them; the editor edits the default). The CCLI SongSelect API (post-MVP, needs a partner agreement).

## Phase 6 — Bible Manager & Quick Scripture

- [x] 🟪 Schema: `bible_translations`, `bible_books`, `bible_book_aliases`, `bible_verses`, `bible_verses_fts`, scripture collections.
- [x] 🟩 `.cmpbible` package importer + OSIS/USFM/Zefania converters (CLI in `packages/import-export` for preparing bundled packages). See [DOCUMENTATION.md §6.1](DOCUMENTATION.md#61-translation-packages).
- [x] 🟪 Reference parser (aliases, ranges, cross-chapter, verse lists) validated against versification. See [DOCUMENTATION.md §6.2](DOCUMENTATION.md#62-reference-parser).
- [x] 🟪 Scripture pagination into Bible slides with `(1/2)` references.
- [x] 🟨 Bible module: translation picker, book/chapter/verse browser, text search with highlights, favourites, collections, "copy to presentation".
- [x] 🟨 Quick Scripture overlay (Ctrl/Cmd+F → preview → display → Esc returns). See [DOCUMENTATION.md §6.5](DOCUMENTATION.md#65-quick-scripture-flow-journey-5).
- [ ] ⬜ Bundle public-domain translations only, after a licence review per translation. See [EXTERNAL_INTEGRATIONS.md §4](EXTERNAL_INTEGRATIONS.md#4-bible-translation-licensing--packages).
- [x] ⬜ Tests: reference parser table tests (≥ 100 cases), overlay pop restores video time.

## Phase 7 — Presentation Editor, Templates & Import

- [x] 🟨 Editor canvas: 16:9/4:3/custom, safe-area guides, snapping, selection, resize/move, z-order, duplicate/delete, undo/redo.
- [x] 🟨 Object inspectors: text (font, size, weight, colour, align, line height, letter spacing, shadow, outline), image, video (loop/mute), background (colour, gradient, image, video, blur, overlay).
- [x] 🟨 Slide strip: create, duplicate, reorder, delete, per-slide transition and auto-duration.
- [x] 🟪 `presentation_versions` snapshot on save, keeping the last 20, with restore. See [DOCUMENTATION.md §9.6](DOCUMENTATION.md#96-presentation-versions).
- [x] 🟪 Templates: `templates` + built-in pack (worship, praise, scripture, sermon, announcements, offering, countdown, events, closing), create from template and save as template. Template-based decks use the same `.cmppres` interchange.
- [x] 🟩 PPTX import (text boxes, images, backgrounds, basic fonts) with a conversion report listing what was dropped. PDF import as one image per page.
- [x] 🟩 Import and export `.cmppres` documents.
- [x] 🟩 Export slides as PNGs and PDF.
- [x] 🟨 Font import + `FontFace` registration, with a licence acknowledgement.
- [x] ⬜ Tests: snapshot round-trip and 20-version retention.
- [ ] ⬜ Tests: PPTX fixture corpus (10 real church decks).
      _Needs real decks: please supply about 10 representative church `.pptx` files (or permission to use specific ones) and they will join the test corpus. A **synthetic corpus** already covers each feature in isolation: `packages/import-export/src/pptx/__tests__` builds real PPTX zips for the cases listed below._

> **PPTX/PDF import, PNG/PDF export and fonts (finished on 2026-11-24).** Verified on macOS arm64 (Electron 45.4.1): `pnpm check` is green with **431 unit tests in 36 files**, and `pnpm test:e2e` passes **19/19**.
>
> **PowerPoint import.** `@cmp/import-export/src/pptx`, run in the utility worker (`worker/pptx.ts`).
>
> - **Slide order:** taken from `sldIdLst`. Hidden slides are skipped and reported.
> - **Text:** text boxes and placeholders, with geometry and styles inherited from slide, layout, master, `txStyles` and the deck's default text style. Supported: size (pt → px at the deck's scale, with `normAutofit` font scale), bold, colour, typeface (theme `+mj`/`+mn` fonts resolved), alignment, vertical anchor, line breaks and bullets (`buChar`/`buNone`, inherited).
> - **Colours:** theme colours through the master colour map, including `lumMod`/`lumOff` and alpha.
> - **Shapes:** groups are flattened with their child transform; `mc:AlternateContent` uses its fallback. Rectangles, rounded rectangles and ellipses become shapes.
> - **Media:** pictures (PNG, JPEG, GIF, WebP) and embedded video go into the media library, deduplicated.
> - **Backgrounds:** slide, layout or master, as colour, gradient (angle converted) or picture.
> - **Transitions:** fade/dissolve become a fade; others become a cut.
> - **Conversion report.** Shown above the imported deck, with counts. It covers tables, charts, SmartArt, other embedded objects, connectors, unsupported shapes, picture crops, EMF/WMF/TIFF pictures, linked media, audio, mixed run formatting, animations, speaker notes, hidden slides and other transitions.
> - **Safety:** `openZipFile` is a bounded random-access reader over a file on disk. It enforces an entry-count limit, a per-entry limit and a total-uncompressed limit, all enforced while streaming, so a lying header cannot get past them. Zip paths are never used as file-system paths. XML with a DOCTYPE or ENTITY declaration is refused.
>
> **PDF import and PNG/PDF export.** A third, hidden renderer entry (`render.html`) is offscreen, sandboxed and under the strict CSP.
>
> - **PDF import:** pdf.js 6 (Apache-2.0) renders pages on the window's own thread (`file://` pages cannot start module workers). pdf.js 6 never evaluates code. Pages are fitted inside 1920×1080, stored as library images through the worker, and become one full-slide picture per page. Limits: 200 MB, 300 pages.
> - **Export:** the same window lays slides out with the real engine. PNGs are taken with `capturePage` at the document's exact pixel size and named `<Title> - 01.png`. The PDF uses `printToPDF` with the page set to the slide size, one slide per page.
> - **Live sessions:** import and export are refused while live, so a service never competes with rasterising for CPU.
> - **Message passing:** results cross the window's MessagePort as a structured clone. Transferred ArrayBuffers arrive in Electron's `MessagePortMain` as null; this was found by e2e.
>
> **Fonts.**
>
> - **Import:** TTF/OTF goes through the media pipeline. The family name is read from the font's `name` table by `@cmp/media-processing/font.ts` (typographic family first, then the English Windows record, with control characters and quotes stripped) and stored in `media_assets.font_family` (migration `0008`).
> - **Licence:** `fonts:import` requires `acknowledged: true` and records it as the font's licence. Only fonts with a licence other than "unknown" are listed and registered, so a font dropped into Media stays unused until its licence is set.
> - **Registration:** registration is additive, so engines sharing a document never unregister each other's faces. It covers the operator window (editor and previews) and every engine through `EngineConfig.fonts`: audience, mirror and export.
> - **Protocol:** `cmp-media://` serves fonts with CORS (`corsEnabled` plus `Access-Control-Allow-Origin` on `font/*` responses only), and the CSP allows `font-src cmp-media:`.
> - **UI:** the editor's font field suggests imported families; Settings → Fonts has the acknowledgement checkbox, the import button and the list.
>
> **Tests.**
>
> - Synthetic PPTX corpus (13 cases): text box properties; 4:3; placeholder, theme and bullet inheritance; groups and mixed formatting; pictures, EMF, crops, picture backgrounds and fades; embedded versus linked video and audio; gradients and shapes; report categories; document building with failed media; non-PPTX files; XXE; a decompression bomb with a lying header (streaming limit, `read` and `extractTo`); too many entries.
> - Font name parser (4 cases).
> - Presentation files service end to end through the in-process worker with a fake renderer (8 cases).
> - Font CORS in the protocol.
> - e2e `import-export.e2e.ts`: PPTX through the UI picker, the report showing "Chart", PNG export (two 1920×1080 files), PDF export (two pages), re-importing that PDF through real pdf.js (two picture slides), refusal while live; and a real system TTF refused without acknowledgement, then imported, listed and `FontFace`-loaded from `cmp-media://`.
>
> **Not done / not verified.**
>
> - The real-deck corpus (above).
> - Rich text runs inside one text box. The engine's text object has one style, so mixed runs are simplified and reported.
> - PPTX tables and charts are reported, not converted.
> - pdf.js's standard-font data is not bundled, so PDFs that rely on the 14 non-embedded standard fonts use system substitutes.

## Phase 8 — Service Planner, Countdown & Announcements

- [ ] 🟪 Schema: `services`, `service_items` (polymorphic, per-type Zod `options_json`), `service_item_groups`, `service_templates`. See [DOCUMENTATION.md §8.1](DOCUMENTATION.md#81-polymorphic-service-items).
- [ ] 🟪 Reference integrity checks on write and a delete guard on referenced entities.
- [ ] 🟪 Service resolution into engine documents for every item type. See [DOCUMENTATION.md §3.2](DOCUMENTATION.md#32-resolution-service-to-engine-documents).
- [ ] 🟪 Countdown (drift-free, chime, `onComplete`) and announcement auto-rotation with pause-on-manual. See [DOCUMENTATION.md §8.4](DOCUMENTATION.md#84-countdown--announcements).
- [ ] 🟨 Planner UI: create from template, add items via quick panels, drag-reorder, groups, notes, full-programme preview, duplicate service, recent and upcoming on Home.
- [ ] 🟨 Home dashboard: recent presentations and services, favourite songs, display status, storage usage, quick actions.
- [ ] ⬜ E2E: Journey 3 (prepare a Sunday service) and Journey 4 (run it) end to end.

## Phase 9 — Offline, Backup & Crash Recovery

- [ ] 🟩 `.cmpbackup` create (SQLite online backup + referenced media + manifest checksums). See [DOCUMENTATION.md §9.3](DOCUMENTATION.md#93-workspace-backup-cmpbackup).
- [ ] 🟩 Restore: verify, `integrity_check`, atomic swap, reload. Blocked during live sessions.
- [ ] 🟪 Scheduled backups (weekly, keep 4), skipped while live.
- [ ] 🟪 Crash-resume prompt from an unfinished `live_sessions` row. See [DOCUMENTATION.md §9.4](DOCUMENTATION.md#94-live-session-journal).
- [ ] ⬜ E2E: full service with network emulation offline. Kill the app mid-service and resume at the same slide.

## Phase 10 — Hardening & Cross-Cutting

- [ ] ⬜ Electron fuses, asar integrity, `npm audit`/`osv-scanner` in CI, Electron version policy (stay within supported majors). See [SECURITY.md](SECURITY.md).
- [ ] ⬜ Fuzz importers (PPTX XML, song files, Bible packages, backups) and zip-slip/bomb limits.
- [ ] ⬜ Performance: p95 slide switch < 100 ms, 2-hour soak test with no memory growth > 150 MB, cold start < 4 s on a 4-year-old i5 laptop.
- [ ] ⬜ Accessibility: keyboard-only operation, focus rings, contrast checks on the dark theme.
- [ ] ⬜ Opt-in crash reporting (path and content scrubbing) and a local diagnostics export ("Save support bundle").
- [ ] ⬜ Hardware test matrix: projectors (VGA via adapter, HDMI), LED processors, 720p/1080p/4K outputs, mirrored vs extended mode, macOS Retina + 1080p projector scaling.
- [ ] ⬜ Real-world rehearsal: 10-min countdown, 5 songs, 20 scripture slides, 3 flyers, 2 videos, sermon deck, an ad-hoc scripture, and a projector unplug and replug.

## Phase 11 — External Integration Certification

- [ ] 🟦 Apple Developer ID certificate, notarytool credentials and hardened-runtime entitlements verified. See [EXTERNAL_INTEGRATIONS.md §1](EXTERNAL_INTEGRATIONS.md#1-apple-developer-id-signing--notarisation).
- [ ] 🟦 Windows code signing (Azure Trusted Signing or EV cert) verified, SmartScreen reputation monitored. See [EXTERNAL_INTEGRATIONS.md §2](EXTERNAL_INTEGRATIONS.md#2-windows-code-signing).
- [ ] 🟦 Update feed on GitHub Releases + R2 mirror verified across alpha → beta → stable. See [EXTERNAL_INTEGRATIONS.md §3](EXTERNAL_INTEGRATIONS.md#3-github-releases--cloudflare-r2-update-feed).
- [ ] ⬜ Written licence on file for every bundled Bible translation, font, template and sample media file. See [EXTERNAL_INTEGRATIONS.md §4–5](EXTERNAL_INTEGRATIONS.md#4-bible-translation-licensing--packages).

## Phase 12 — Deployment Readiness

- [ ] 🟦 electron-builder release workflow on tag: Windows NSIS, macOS universal DMG + zip, signed, notarised and stapled. See [HOSTING.md](HOSTING.md#production-deployment).
- [ ] 🟦 Staged rollout via `stagingPercentage`, with the rollback procedure rehearsed. See [RUNBOOK.md](RUNBOOK.md#rollback).
- [ ] 🟨 Product website download page, installation guide, "first Sunday" checklist, sample content pack.
- [ ] ⬜ Beta programme: 5–10 churches with varied hardware, a weekly feedback form, and an incident log per service.
- [ ] ⬜ Definition of done (PRD §14.3) signed off: real projector, no exposed controls, 1080p video, song↔scripture switching, 2-hour simulated service, offline, projector recovery, backup restore, persistence across restart, installs on supported Windows and macOS.

---

## Post-MVP (product roadmap, not scheduled)

- **Phase 2 (advanced presentation):** multiple independent outputs with stage display ([DOCUMENTATION.md §4.4](DOCUMENTATION.md#44-phase-2-multiple-outputs)), advanced transitions, video background layering, better PPTX conversion, a version history UI.
- **Phase 3 (live production):** camera input (`getUserMedia`/NDI), livestream output, lower thirds, PiP, live captions (on-device speech-to-text), phone remote over LAN with pairing.
- **Phase 4 (content ecosystem):** `apps/api` catalogue + media packs ([DOCUMENTATION.md §10](DOCUMENTATION.md#10-content-catalogue--media-packs-post-mvp)), community templates, contributor programme, optional cloud sync, multi-user roles.

## Suggested build order (critical path)

```
Phase 0 → Phase 1 → Phase 2 (engine + displays) → Phase 3 (live control)
                                   │
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
     Phase 4 (media)        Phase 5 (songs)        Phase 6 (bible)
            └──────────┬───────────┴──────────────────────┘
                       ▼
             Phase 7 (editor/templates/import)
                       ▼
             Phase 8 (service planner)  →  Phase 9 (offline/backup/recovery)
                       ▼
             Phases 10–12 (hardening, certification, release)
```

Phases 4, 5 and 6 can run in parallel once the engine accepts generic `EngineDocument`s.
