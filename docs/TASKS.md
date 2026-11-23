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

- [ ] 🟪 Main process lifecycle: single-instance lock, `app.whenReady`, window-state persistence, electron-log.
- [x] 🟪 Hardened `BrowserWindow` factory (contextIsolation, sandbox, CSP, navigation and new-window blocking). See [DOCUMENTATION.md §2.1](DOCUMENTATION.md#21-window-security-configuration). _(Landed early in Phase 0: `createSecureWindow()` + `hardenApp()`, covered by e2e.)_
- [ ] 🟪 IPC router with a Zod schema registry, `IpcResult` envelope and error codes, plus a test asserting that every channel has a schema. See [DOCUMENTATION.md §2.2–2.3](DOCUMENTATION.md#22-preload-api-surface).
- [ ] 🟪 Typed preload bridge `window.cmp` generated from the shared channel map.
- [ ] 🟪 `packages/database`: Drizzle schema for workspace, users, settings, presentations, slides and slide_objects. WAL pragmas, migration runner, pre-migration backup hook. See [DOCUMENTATION.md §9.2](DOCUMENTATION.md#92-migrations).
- [ ] 🟪 Repository pattern + `settings` repository with typed keys. See [DOCUMENTATION.md §13](DOCUMENTATION.md#13-filesystem--settings-key-catalog).
- [ ] 🟪 `cmp-media://` privileged protocol with path confinement and Range support.
- [ ] 🟨 App shell: sidebar navigation (Home, Live, Services, Presentations, Songs, Bible, Media, Templates, Downloads, Settings), theme switch, offline indicator.
- [ ] 🟨 First-launch onboarding: church name, logo, output resolution, theme. See [DOCUMENTATION.md §17.3](DOCUMENTATION.md#173-onboarding-journey-1).
- [ ] ⬜ Tests: repository unit tests on an in-memory SQLite, and an IPC validation rejection test.

## Phase 2 — Display Manager & Presentation Engine prototype (first milestone)

Goal: prove the six things in the PRD. Projector detected, separate fullscreen audience window, text and images rendered, local 1080p video plays smoothly, operator controls the output, and it all works offline.

- [ ] 🟪 Display Manager: enumerate, identify overlay, assign, `display_profiles` fingerprinting, test pattern. See [DOCUMENTATION.md §4.1](DOCUMENTATION.md#41-detection--selection).
- [ ] 🟪 Audience window placement (frameless fullscreen, black background, `ready-to-show`, macOS `simpleFullscreen`). See [DOCUMENTATION.md §4.2](DOCUMENTATION.md#42-audience-window-placement).
- [ ] 🟪 `MessageChannelMain` audience port and the sequence-numbered `EngineCommand` protocol. See [DOCUMENTATION.md §2.4](DOCUMENTATION.md#24-audience-channel).
- [ ] 🟪 `presentation-engine`: `PresentationLoader` (Zod + schema versioning), `SlideRenderer` (Text, Image, Video), `OutputController` (letterbox scaling, safe areas). See [DOCUMENTATION.md §3.3](DOCUMENTATION.md#33-engine-internals).
- [ ] 🟪 Double-buffered front/back layers, image `decode()` before swap, video first-frame preload, background-video continuity across slides.
- [ ] 🟪 `TransitionManager`: cut and fade.
- [ ] 🟪 Media failure → fallback background + `engine:state` warning.
- [ ] 🟨 Minimal operator test page: load a hard-coded deck, next/prev, black screen, display picker.
- [ ] ⬜ Engine unit tests (jsdom) for command idempotency (`seq`), goto bounds and fallback behaviour.
- [ ] ⬜ Hardware smoke test on a real projector: laptop + HDMI projector, and desktop + LED wall over HDMI. Record slide-switch latency.

## Phase 3 — Live Control & hot-plug recovery

- [ ] 🟪 `LiveSessionController`: state machine (idle → preparing → live ↔ masked/overlay/suspended → ended), `live_sessions` journal with 250 ms debounce. See [DOCUMENTATION.md §3.1](DOCUMENTATION.md#31-session-state-machine).
- [ ] 🟪 Live commands: next, prev, goto, item next/goto, blank, logo, clear, video transport (play/pause/stop/seek/volume/mute).
- [ ] 🟪 Overlay stack (`overlayPush`/`overlayPop`) with snapshot and restore of item, slide and video time.
- [ ] 🟪 Hot-plug handling: suspend on removal, auto-restore on fingerprint match, prompt on unknown display, metrics change rescale. See [DOCUMENTATION.md §4.3](DOCUMENTATION.md#43-hot-plug).
- [ ] 🟪 Single-display preview mode.
- [ ] 🟨 Live workspace UI: current, audience mirror and next previews (embedding the engine in preview mode), playlist, thumbnails, transport bar, always-visible BLACK/LOGO/CLEAR, display status chip, disconnection banner. See [DOCUMENTATION.md §3.4](DOCUMENTATION.md#34-operator-live-workspace).
- [ ] 🟨 Keyboard shortcut layer with focus guards and remapping UI. Works with PageUp/PageDown clickers. See [DOCUMENTATION.md §3.5](DOCUMENTATION.md#35-keyboard-shortcuts-defaults-configurable).
- [ ] ⬜ E2E: start session → advance 20 slides → unplug the simulated display → re-add it → assert the same slide is shown.

## Phase 4 — Media Library

- [ ] 🟪 Schema: `media_assets`, `media_folders`, `media_tags`, `media_asset_tags`, `media_licences`.
- [ ] 🟩 `utilityProcess` job runner with `job:progress` events and cancellation.
- [ ] 🟩 Import pipeline: magic-byte validation, streamed SHA-256, dedupe, atomic copy, ffprobe, thumbnail/poster, GIF→MP4 offer, transcode offer for unsupported codecs. See [DOCUMENTATION.md §7](DOCUMENTATION.md#7-media-import-pipeline).
- [ ] 🟩 Bundle ffmpeg/ffprobe static binaries per platform (licence check: LGPL build).
- [ ] 🟪 Missing-file scan at startup and on demand. Deleting a referenced asset is blocked with `usedBy`.
- [ ] 🟨 Library UI: grid/list, folders, tags, categories, favourites, search, drag-and-drop, hover video preview, file size, missing badges.
- [ ] ⬜ Tests: duplicate import returns the existing asset, interrupted copy leaves no partial file, path traversal rejected by `cmp-media://`.

## Phase 5 — Song Manager

- [ ] 🟪 Schema: `songs`, `song_sections`, `song_arrangements`, `song_collections`, `songs_fts` (unicode61 with diacritics removed).
- [ ] 🟪 Lyrics parser (section headers, stanzas) and lyrics-to-slides generator with line/char split and measured auto-fit. See [DOCUMENTATION.md §5.2](DOCUMENTATION.md#52-algorithm).
- [ ] 🟪 `songs:search` with weighted bm25 ranking.
- [ ] 🟪 Song file importers: plain text, OpenLyrics XML, CCLI SongSelect text/USR.
- [ ] 🟪 Live lyric edit → slide diff → `live:patch`. See [DOCUMENTATION.md §3.6](DOCUMENTATION.md#36-live-edits).
- [ ] 🟨 Song editor: sections, arrangement builder (drag chips such as `V1 C V2 C B C`), split settings, background and template picker, generated slide preview, copyright fields.
- [ ] 🟨 Collections (Praise, Worship, Hymns, Communion, Christmas, Easter, Nigerian gospel).
- [ ] ⬜ Tests: parser fixtures (including Yoruba/Igbo diacritics), split and fit edge cases, search ranking.

## Phase 6 — Bible Manager & Quick Scripture

- [ ] 🟪 Schema: `bible_translations`, `bible_books`, `bible_book_aliases`, `bible_verses`, `bible_verses_fts`, scripture collections.
- [ ] 🟩 `.cmpbible` package importer + OSIS/USFM/Zefania converters (CLI in `packages/import-export` for preparing bundled packages). See [DOCUMENTATION.md §6.1](DOCUMENTATION.md#61-translation-packages).
- [ ] 🟪 Reference parser (aliases, ranges, cross-chapter, verse lists) validated against versification. See [DOCUMENTATION.md §6.2](DOCUMENTATION.md#62-reference-parser).
- [ ] 🟪 Scripture pagination into Bible slides with `(1/2)` references.
- [ ] 🟨 Bible module: translation picker, book/chapter/verse browser, text search with highlights, favourites, collections, "copy to presentation".
- [ ] 🟨 Quick Scripture overlay (Ctrl/Cmd+F → preview → display → Esc returns). See [DOCUMENTATION.md §6.5](DOCUMENTATION.md#65-quick-scripture-flow-journey-5).
- [ ] ⬜ Bundle public-domain translations only, after a licence review per translation. See [EXTERNAL_INTEGRATIONS.md §4](EXTERNAL_INTEGRATIONS.md#4-bible-translation-licensing--packages).
- [ ] ⬜ Tests: reference parser table tests (≥ 100 cases), overlay pop restores video time.

## Phase 7 — Presentation Editor, Templates & Import

- [ ] 🟨 Editor canvas: 16:9/4:3/custom, safe-area guides, snapping, selection, resize/move, z-order, duplicate/delete, undo/redo.
- [ ] 🟨 Object inspectors: text (font, size, weight, colour, align, line height, letter spacing, shadow, outline), image, video (loop/mute), background (colour, gradient, image, video, blur, overlay).
- [ ] 🟨 Slide strip: create, duplicate, reorder, delete, per-slide transition and auto-duration.
- [ ] 🟪 `presentation_versions` snapshot on save, keeping the last 20, with restore. See [DOCUMENTATION.md §9.6](DOCUMENTATION.md#96-presentation-versions).
- [ ] 🟪 Templates: `templates` + built-in pack (worship, praise, scripture, sermon, announcements, offering, countdown, events, closing), apply/save-as/export/import.
- [ ] 🟩 PPTX import (text boxes, images, backgrounds, basic fonts) with a conversion report listing what was dropped. PDF import as one image per page.
- [ ] 🟩 Export: slide PNGs, PDF, `.cmppres`.
- [ ] 🟨 Font import + `FontFace` registration, with a licence acknowledgement.
- [ ] ⬜ Tests: PPTX fixture corpus (10 real church decks), snapshot round-trip.

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
