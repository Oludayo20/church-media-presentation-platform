# Architecture Documentation

## Church Media & Worship Presentation Platform

> Summary document. Each section links into [`DOCUMENTATION.md`](DOCUMENTATION.md) for the diagram-by-diagram detail.

---

## 1. Overview

A free, desktop-first, offline-first application that gives a church media operator one place to prepare and run everything shown on the church screens: lyrics, scripture, motion backgrounds, gospel videos, announcements, flyers, sermon slides, offering slides and countdowns. Operators no longer juggle PowerPoint, VLC, a browser Bible and a USB stick of flyers.

The application has two faces:

- **Operator window** (primary monitor): dashboard, editors, planner and live controls.
- **Audience window** (projector or LED screen): a borderless fullscreen output that shows only congregation-facing content. It never shows controls.

### The core value proposition

> The pastor, worship leader and media team never have to worry about what appears on the screen.

Every architectural decision serves one constraint: **a live service must never stop.** That constraint leads to these decisions:

| Constraint                                                | Architectural consequence                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Internet may drop mid-service                             | All content is stored locally (SQLite plus a local media store). The cloud is optional, and playback never awaits the network.                                     |
| Projector may disconnect                                  | The Display Manager watches `screen` events, suspends output, retains position and restores output on reconnect. See [§7](#7-display-management--recovery).        |
| Operator may load or edit content during the live service | Live state and preview/editor state are separate. The audience renderer only reacts to explicit `live:*` commands. See [§6](#6-live-presentation-lifecycle).       |
| App or OS may crash                                       | Live sessions are journaled to `live_sessions`, so a relaunch offers "Resume service at item 5, slide 3". See [§9](#9-offline-first-persistence-backup--recovery). |
| Volunteers, not engineers, run it                         | The UI is simple and dark-first, shortcuts are configurable, no account is required and onboarding is guided.                                                      |

### Non-goals (out of scope for this design)

- Church management (membership, attendance, giving records, payroll, accounting).
- Online giving or payment processing. Offering slides only _display_ payment details.
- A web-only player. Display control, filesystem access and offline playback require a desktop runtime.
- Live camera switching, livestream output, AI captions, phone remote control and multi-output routing are post-MVP (Phases 2–3 of the product roadmap). The architecture leaves seams for them but does not build them.
- Bundling copyrighted Bible translations or songs without a licence.
- Linux in the first stable release. It is planned but not certified.

---

## 2. Tech Stack

| Layer                     | Technology                                                                                    | Reason                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Desktop runtime           | Electron                                                                                      | Cross-platform, `screen` API for display detection, multiple native windows, filesystem access |
| UI                        | React 19 + TypeScript 6.0 (strict)                                                            | Component-based operator UI. TS pinned to 6.0.x until typescript-eslint supports TS 7.         |
| Build                     | electron-vite 6 on Vite 8 (Rolldown)                                                          | Fast HMR for the renderer, bundles main and preload                                            |
| Styling                   | Tailwind CSS v4 + shadcn/ui                                                                   | Consistent, accessible, dark-first design system                                               |
| Client state              | Zustand                                                                                       | Lightweight stores for editor and live UI state                                                |
| Forms/validation          | React Hook Form + Zod                                                                         | Zod schemas are shared with the IPC layer                                                      |
| Local database            | SQLite (Node's built-in `node:sqlite`)                                                        | Synchronous, fast, single-file, offline, no native module                                      |
| ORM                       | Drizzle ORM + drizzle-kit migrations                                                          | Type-safe queries, plain SQL migrations                                                        |
| Search                    | SQLite FTS5                                                                                   | Lyrics and scripture full-text search with no extra service                                    |
| Rendering                 | DOM/CSS compositing + Canvas/WebGL for effects                                                | Crisp text, GPU-accelerated transforms and video                                               |
| Media                     | HTML5 `<video>`/`<audio>` (Chromium media stack) + ffprobe/ffmpeg for metadata and thumbnails | Native hardware decode, no extra player process                                                |
| PPTX import               | JSZip + XML parsing (custom mapper)                                                           | Best-effort conversion of text, images and backgrounds                                         |
| Packaging                 | electron-builder                                                                              | NSIS (Windows), DMG (macOS), signing and notarisation hooks                                    |
| Updates                   | electron-updater (GitHub Releases / R2 feed)                                                  | Staged, signed auto-update                                                                     |
| Testing                   | Vitest, Playwright (Electron), hardware test matrix                                           | Unit, integration, E2E and real-projector tests                                                |
| Optional cloud (post-MVP) | NestJS, PostgreSQL, Redis + BullMQ, Cloudflare R2, Next.js admin                              | Content catalogue, media packs and optional sync                                               |
| Monorepo                  | pnpm workspaces + Turborepo                                                                   | Separate engine, database and app packages                                                     |

### 2.1 Why Electron over a web app or Tauri

A web app cannot reliably place a borderless fullscreen window on a chosen external monitor, read large local video files without user prompts, or run offline after a cold start. Tauri is lighter, but it uses the OS webview, which means WebKit on macOS and WebView2 on Windows. That gives inconsistent codec support (HEVC, VP9 and WebM alpha behave differently) and inconsistent rendering across the exact hardware churches own. Electron ships one known Chromium media stack everywhere, and that predictability is worth the install size for a product whose job is video playback.

### 2.2 Why SQLite over a remote database

The app must work with no network and no account. SQLite gives transactional, single-file storage that is trivial to back up (copy the file plus the media store) and FTS5 for search. PostgreSQL appears only in the optional cloud catalogue.

### 2.3 Why a React-free presentation engine

If the audience output were "a React page that shows slides", any re-render, state bug or heavy editor operation in the operator UI could stutter the projector. The engine (`packages/presentation-engine`) is plain TypeScript that owns its own DOM subtree in the audience window. It consumes a versioned presentation document and a stream of commands, so it can be unit-tested and benchmarked independently of the UI. The operator previews embed the _same_ engine in a read-only "preview" mode, which guarantees what-you-see-is-what-they-see.

### 2.4 Why content-addressed media storage

Absolute file paths break when a church copies its workspace to a new laptop. Imported media is copied into `<workspace>/media/<sha256-prefix>/<sha256>.<ext>`, and every slide references a stable `asset_id`. Duplicate imports are detected for free, and backups are portable.

### 2.5 Why `node:sqlite` in the main process only

The renderer is sandboxed and has no Node access. All database access goes through repositories in the main process, exposed over validated IPC. Synchronous SQLite calls are fast enough for this data size and avoid callback interleaving bugs.

The driver is Node's built-in `node:sqlite` (SQLite 3.5x with FTS5 and the online backup API) rather than better-sqlite3, which was the original plan. The built-in is present in both Electron's Node and the Node that runs Vitest. As a result there is no native module to rebuild per Electron ABI, no prebuilt binary to download, no install script to allow, and no per-architecture `.node` file to sign. Drizzle has no stable `node:sqlite` driver yet, so `packages/database` drives it through `drizzle-orm/sqlite-proxy`. Drizzle builds the SQL and a synchronous callback executes it. Transactions are serialised on the single connection and must not await real I/O. Long jobs (PPTX import, thumbnailing, backup) run in a `utilityProcess` worker so the main process stays responsive.

---

## 3. High-Level Architecture

```
┌──────────────────────────── Electron desktop application ────────────────────────────┐
│                                                                                       │
│  Operator window (renderer, sandboxed)          Audience window (renderer, sandboxed) │
│  ┌──────────────────────────────────────┐       ┌──────────────────────────────────┐  │
│  │ React UI: Home · Live · Services ·    │       │ Presentation Engine (no React)   │  │
│  │ Presentations · Songs · Bible ·       │       │ SlideRenderer · VideoRenderer ·  │  │
│  │ Media · Templates · Settings          │       │ TransitionManager · Playback     │  │
│  │ Preview engines (read-only)           │       └───────────────▲──────────────────┘  │
│  └──────────────┬───────────────────────┘                       │ live:* commands     │
│                 │ window.cmp.* (preload, typed)                 │ (MessagePort)       │
│  ┌──────────────▼───────────────────────────────────────────────┴──────────────────┐  │
│  │ Main process: IPC router (Zod) · LiveSessionController · DisplayManager ·        │  │
│  │ WindowManager · Repositories (Drizzle) · MediaStore · Updater · Lifecycle        │  │
│  └──────────────┬───────────────────────────────┬──────────────────────────────────┘  │
│                 │                               │ jobs                                │
│        ┌────────▼────────┐             ┌────────▼─────────┐                           │
│        │ SQLite + FTS5   │             │ utilityProcess:  │                           │
│        │ workspace.db    │             │ import · thumbs  │                           │
│        └─────────────────┘             │ backup · pptx    │                           │
│        ┌─────────────────┐             └──────────────────┘                           │
│        │ media/ store    │                                                            │
│        └─────────────────┘                                                            │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │ optional, HTTPS, post-MVP
                              ┌─────────────▼───────────────┐
                              │ Cloud API (NestJS) · Postgres│
                              │ R2 media packs · update feed │
                              └──────────────────────────────┘
```

Detail: [DOCUMENTATION.md §1](DOCUMENTATION.md#1-system-architecture) and [§2](DOCUMENTATION.md#2-electron-process--ipc-boundary).

---

## 4. Service Breakdown

This is a desktop app, so most "services" are modules inside one process tree rather than network services. Each subsection names its directory and its IPC namespace (or port, for the dev server and the optional cloud API).

### 4.1 Main process (`apps/desktop/electron/main`) — IPC router

Owns app lifecycle, single-instance lock, windows, the IPC router, repositories and the workers. Every `ipcMain.handle` channel validates its input with the shared Zod schema from `packages/shared-validation` and returns a `{ success, data | error }` envelope.

### 4.2 Preload bridge (`apps/desktop/electron/preload`) — `window.cmp`

Exposes a narrow, typed API (`window.cmp.presentations.create(...)`, `window.cmp.live.next()` and so on) through `contextBridge`. It does not expose `ipcRenderer`, `require` or arbitrary channel names.

### 4.3 Operator renderer (`apps/desktop/src`) — Vite dev server port 5173

React app organised by feature: `dashboard`, `live`, `presentations`, `songs`, `bible`, `media`, `services`, `templates`, `settings`. Zustand stores hold UI state. Persistent data always round-trips through IPC.

### 4.4 Audience renderer (`apps/desktop/src/audience` + `packages/presentation-engine`) — `live:*`

A minimal HTML entry that boots the Presentation Engine. It receives commands over a dedicated `MessagePort` from the main process and reports `engine:state` (current slide, video time, errors) back. It holds no database handle.

### 4.5 Presentation Engine (`packages/presentation-engine`)

`PresentationLoader → SlideRenderer (Text/Image/Video/Shape/Bible) → TransitionManager → PlaybackController → TimelineManager → MediaResolver → OutputController`. It double-buffers the current and next slide so advancing never waits on decode. See [DOCUMENTATION.md §3](DOCUMENTATION.md#3-live-presentation-lifecycle).

### 4.6 Display Manager (`apps/desktop/electron/main/displays`) — `displays:*`

Wraps Electron's `screen` API: enumerate, identify, test-pattern, assign the audience display, and handle hot-plug through `display-added`, `display-removed` and `display-metrics-changed`. See [§7](#7-display-management--recovery).

### 4.7 Live Session Controller (`apps/desktop/electron/main/live`) — `live:*`, `services:start`

The single source of truth for "what is on screen". It resolves the service playlist into engine documents, forwards commands, journals state to `live_sessions`, and manages the Quick Scripture overlay stack.

### 4.8 Content repositories (`packages/database/repositories`) — `presentations:*`, `slides:*`, `songs:*`, `bible:*`, `media:*`, `services:*`, `templates:*`, `settings:*`

Drizzle-backed repositories. Each one is the only code allowed to touch its tables.

### 4.9 Media Store & processing (`packages/media-processing`) — `media:*`

Handles import (copy, hash, dedupe), ffprobe metadata, thumbnail and poster generation, missing-file scans and licence metadata.

### 4.10 Import/Export Engine (`packages/import-export`) — `import:*`, `export:*`, `backup:*`

Handles PPTX/PDF import, song file import (plain text, OpenLyrics XML, CCLI SongSelect `.usr`/`.txt`), Bible package import (OSIS/USFM/Zefania to the internal format), slide image and PDF export, and workspace backup and restore.

### 4.11 Updater (`apps/desktop/electron/main/lifecycle/updater.ts`) — `app:update:*`

electron-updater against a signed feed. It **never installs while a live session is active**. It defers to app quit.

### 4.12 Optional Cloud API (`apps/api`) — port 4000 (post-MVP)

NestJS modules `auth`, `churches`, `catalogue`, `media-packs` and `sync`, with PostgreSQL, Redis/BullMQ (pack building, virus scanning) and Cloudflare R2. The desktop app downloads packs into the same content-addressed store. See [DOCUMENTATION.md §10](DOCUMENTATION.md#10-content-catalogue--media-packs-post-mvp).

---

## 5. Event-Driven Architecture

There is no message broker in the MVP. The "event bus" is the IPC topology:

| Direction                          | Mechanism                               | Examples                                                           |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| Operator → Main (request/response) | `ipcRenderer.invoke` → `ipcMain.handle` | `songs:search`, `services:start`, `media:import`                   |
| Main → Operator (push)             | `webContents.send`                      | `displays:changed`, `live:state`, `job:progress`, `network:status` |
| Main ↔ Audience (low-latency)      | `MessageChannelMain` port pair          | `live:render`, `live:blank`, `video:play`, `engine:state`          |
| Main ↔ Worker                      | `utilityProcess` + `MessagePort`        | `job:pptx-import`, `job:thumbnail`, `job:backup`                   |

Commands to the audience window are **idempotent and sequence-numbered** (`seq`). The engine ignores any command with `seq <= lastApplied`, so a retried or duplicated command can never double-advance a slide. The engine echoes `engine:state { seq, slideId, videoTime }` back, and the controller journals it. Detail: [DOCUMENTATION.md §2](DOCUMENTATION.md#2-electron-process--ipc-boundary).

---

## 6. Live presentation lifecycle

1. `services:start { serviceId, displayId }` creates a `live_sessions` row, resolves every service item into an engine document (songs to lyric slides, scripture to Bible slides, media to video or image slides), and opens or reuses the audience window.
2. The engine loads item 0, preloads slide 0 and slide 1 (decoding the video to its first frame), and reports `ready`.
3. Operator commands (`next`, `prev`, `goto`, `blank`, `logo`, `clear`, `item:next`, `video:*`) flow through the controller, which stamps `seq`, journals the state and forwards it to the engine.
4. **Quick Scripture** and other ad-hoc content push an _overlay frame_ on top of the playlist. Dismissing it pops back to the exact previous item, slide and video time.
5. Edits made in the editor or a live lyric fix are written to the database, and then the controller sends `live:patch` for the affected slide only. The engine swaps it in without resetting the background video.
6. `live:end` closes the session (`ended_at`) and shows the logo or black screen.

Detail and state machine: [DOCUMENTATION.md §3](DOCUMENTATION.md#3-live-presentation-lifecycle).

---

## 7. Display management & recovery

- Enumerate displays with `screen.getAllDisplays()`. Show a numbered identify overlay on each one so the operator can pick the projector.
- Create the audience window with `frame: false`, `fullscreen: true`, `backgroundColor: '#000'`, `skipTaskbar`, `focusable: false` on the chosen display's bounds. With only one screen, it falls back to an in-app **preview mode**.
- Persist the choice in `display_profiles`, keyed by a fingerprint of display size, scale factor and label, so next Sunday reconnects automatically.
- When the audience display is removed, hide the audience window, keep the engine state alive, show a red banner, and keep the operator controls working (the previews still update).
- When a display is added that matches the fingerprint, re-place the window, re-enter fullscreen and re-render the current frame. Position is never lost.

Detail: [DOCUMENTATION.md §4](DOCUMENTATION.md#4-display-management--recovery).

---

## 8. Content pipelines

- **Lyrics to slides**: song sections are combined with the arrangement order, split by lines-per-slide or a character budget, and fitted to the template's text box using measured text with auto-shrink to a floor size. Detail: [DOCUMENTATION.md §5](DOCUMENTATION.md#5-lyrics-to-slides-pipeline).
- **Scripture**: a reference parser handles alternate book names, ranges and cross-chapter references, followed by FTS5 text search. Long passages auto-paginate with "(cont.)" references. Detail: [DOCUMENTATION.md §6](DOCUMENTATION.md#6-bible--quick-scripture).
- **Media import**: copy, SHA-256, dedupe, ffprobe, then thumbnail or poster frame, then a library row. Detail: [DOCUMENTATION.md §7](DOCUMENTATION.md#7-media-import-pipeline).
- **Service planning**: polymorphic `service_items` (`item_type` plus `ref_id`, validated per type). Detail: [DOCUMENTATION.md §8](DOCUMENTATION.md#8-service-planning).

---

## 9. Offline-first persistence, backup & recovery

- SQLite runs in WAL mode with `foreign_keys=ON`. Migrations run at startup, inside a transaction, after an automatic pre-migration backup.
- Presentations are stored as relational rows _and_ versioned JSON snapshots (`presentation_versions`, schema version `cmp.presentation/v1`) for undo history and portable export.
- `.cmpbackup` is a zip of `workspace.db` (made with the SQLite online backup API), the referenced media, and a `manifest.json` with checksums. Restore verifies the checksums before swapping the workspace atomically.
- Crash recovery: on launch, a `live_sessions` row with `ended_at IS NULL` triggers the prompt "Resume Sunday Service at Praise & Worship, slide 3?"

Detail: [DOCUMENTATION.md §9](DOCUMENTATION.md#9-offline-first-backup--crash-recovery).

---

## 10. Data Model

### SQLite (`workspace.db`): table summary

| Group              | Tables                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace & users  | `churches`, `users`, `church_members`, `settings`, `activity_logs`, `app_migrations`                                                                 |
| Presentations      | `presentations`, `slides`, `slide_objects`, `slide_transitions`, `presentation_versions`                                                             |
| Songs              | `songs`, `song_sections`, `song_arrangements`, `song_collections`, `song_collection_items`, `songs_fts`                                              |
| Bible              | `bible_translations`, `bible_books`, `bible_book_aliases`, `bible_verses`, `bible_verses_fts`, `scripture_collections`, `scripture_collection_items` |
| Media              | `media_assets`, `media_folders`, `media_tags`, `media_asset_tags`, `media_licences`                                                                  |
| Services           | `services`, `service_items`, `service_item_groups`, `service_templates`                                                                              |
| Templates          | `templates`, `template_objects`                                                                                                                      |
| Live & devices     | `live_sessions`, `display_profiles`                                                                                                                  |
| Downloads & backup | `download_packages`, `downloaded_assets`, `backup_records`                                                                                           |

Full DDL and relationships: [DOCUMENTATION.md §12](DOCUMENTATION.md#12-data-model).

### Filesystem keys

| Path                                                     | Contents                                      |
| -------------------------------------------------------- | --------------------------------------------- |
| `<userData>/workspaces/<churchId>/workspace.db`          | SQLite database                               |
| `<userData>/workspaces/<churchId>/media/ab/abcdef….mp4`  | Content-addressed media                       |
| `<userData>/workspaces/<churchId>/thumbs/<assetId>.webp` | Thumbnails and poster frames                  |
| `<userData>/backups/`                                    | Automatic pre-migration and scheduled backups |
| `<userData>/logs/main.log`                               | Rotating logs (electron-log)                  |

---

## 11. Suggested repository layout

```
church-media-presentation-platform/
├── apps/
│   ├── desktop/
│   │   ├── electron/
│   │   │   ├── main/{windows,displays,live,filesystem,ipc,jobs,lifecycle}/
│   │   │   └── preload/
│   │   ├── src/
│   │   │   ├── app/  components/  hooks/  stores/  styles/
│   │   │   ├── audience/                 # audience window entry
│   │   │   └── features/{dashboard,live,presentations,songs,bible,media,services,templates,settings}/
│   │   └── tests/{unit,e2e}/
│   └── api/                              # optional cloud (post-MVP)
│       └── src/{auth,churches,catalogue,media-packs,sync}/
├── packages/
│   ├── presentation-engine/{renderer,playback,transitions,timeline}/
│   ├── database/{schema,migrations,repositories}/
│   ├── shared-types/
│   ├── shared-validation/                # Zod schemas: IPC + REST
│   ├── media-processing/
│   ├── import-export/
│   └── design-system/
├── assets/{icons,sample-media,templates,bibles}/
├── docs/
├── package.json · pnpm-workspace.yaml · turbo.json
└── README.md
```

**Architectural rules**

1. `presentation-engine` must not import React or anything from `apps/`.
2. Database access goes through `packages/database/repositories` only.
3. Every IPC handler validates input with a `shared-validation` schema.
4. Renderers never get Node.js access.
5. Presentation documents carry a schema version and are migrated forward on load.
6. Media is referenced by `asset_id`, never by an absolute path.
7. The app must start, plan and present with the cloud API unreachable.
