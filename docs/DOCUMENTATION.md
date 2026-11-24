# Complete Platform Documentation

## Church Media & Worship Presentation Platform

The exhaustive companion to [`ARCHITECTURE.md`](ARCHITECTURE.md). Each numbered section matches a Graphviz diagram in [`diagrams/src/`](diagrams/src/README.md) and is written so you can follow it without the diagram open.

## Table of contents

1. [System architecture](#1-system-architecture)
2. [Electron process & IPC boundary](#2-electron-process--ipc-boundary)
3. [Live presentation lifecycle](#3-live-presentation-lifecycle)
4. [Display management & recovery](#4-display-management--recovery)
5. [Lyrics-to-slides pipeline](#5-lyrics-to-slides-pipeline)
6. [Bible & Quick Scripture](#6-bible--quick-scripture)
7. [Media import pipeline](#7-media-import-pipeline)
8. [Service planning](#8-service-planning)
9. [Offline-first, backup & crash recovery](#9-offline-first-backup--crash-recovery)
10. [Content catalogue & media packs (post-MVP)](#10-content-catalogue--media-packs-post-mvp)
11. [IPC & API reference](#11-ipc--api-reference)
12. [Data model](#12-data-model)
13. [Filesystem & settings key catalog](#13-filesystem--settings-key-catalog)
14. [Security & idempotency](#14-security--idempotency)
15. [Release & distribution topology](#15-release--distribution-topology)
16. [Repository layout](#16-repository-layout)
17. [Product scope, roles & user journeys](#17-product-scope-roles--user-journeys)

---

## 1. System architecture

Diagram: [`01-system-architecture.dot`](diagrams/src/01-system-architecture.dot)

The product is a single Electron application with three kinds of process:

| Process               | Count            | Trust              | Responsibilities                                                                               |
| --------------------- | ---------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| **Main**              | 1                | Full Node.js       | Lifecycle, windows, displays, IPC router, SQLite, filesystem, updater, live session controller |
| **Operator renderer** | 1                | Sandboxed          | React UI for every module, plus read-only preview engines                                      |
| **Audience renderer** | 0–1 (Phase 2: N) | Sandboxed, minimal | Presentation Engine only. Fullscreen on the projector.                                         |
| **Utility worker**    | 1 (pooled jobs)  | Node.js, no UI     | PPTX/PDF import, ffmpeg thumbnails, backups, Bible package import                              |

Local storage is one SQLite database per church workspace plus a content-addressed media folder. The optional cloud (post-MVP) is reachable over HTTPS for catalogue browsing, pack downloads and update checks. The app treats every cloud call as best-effort, and no presentation path awaits one.

**Network-status indicator**: the main process polls `net.isOnline()` and a lightweight HEAD request to the update feed every 60 s. It pushes `network:status` to the UI, which only changes an icon and enables or disables the Downloads module.

---

## 2. Electron process & IPC boundary

Diagram: [`02-process-ipc-boundary.dot`](diagrams/src/02-process-ipc-boundary.dot)

### 2.1 Window security configuration

Every `BrowserWindow` is created with:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  spellcheck: false,          // audience window
  preload: preloadPath,
}
```

Plus:

- A strict CSP in each HTML entry: `default-src 'self'; img-src 'self' cmp-media: data:; media-src 'self' cmp-media:; script-src 'self'`.
- `setWindowOpenHandler(() => ({ action: 'deny' }))`, and `will-navigate` is blocked.
- Media is served through a custom privileged protocol, `cmp-media://asset/<assetId>`. The handler resolves the asset ID to a path _inside_ the workspace media folder, rejects path traversal, and supports `Range` requests so `<video>` can seek.

### 2.2 Preload API surface

```ts
contextBridge.exposeInMainWorld('cmp', {
  presentations: { create, get, list, update, delete, duplicate },
  slides:        { create, update, reorder, delete },
  songs:         { create, get, search, update, delete, generateSlides },
  bible:         { translations, lookup, search, installPackage },
  media:         { import, list, search, update, delete, scanMissing },
  services:      { create, get, list, update, duplicate, start },
  templates:     { list, create, apply, export, import },
  live:          { next, prev, goto, blank, logo, clear, itemNext, itemGoto,
                   video, overlayPush, overlayPop, patch, end, onState },
  displays:      { list, identify, assign, testPattern, onChanged },
  backup:        { create, restore, list },
  settings:      { get, set },
  app:           { version, checkForUpdates, onNetworkStatus },
});
```

Each function maps to exactly one channel. The main-process router looks up the Zod schema for that channel, runs `schema.safeParse(payload)`, and returns `{ success: false, error: { code: 'VALIDATION_ERROR', issues } }` on failure. A channel without a registered schema fails at startup: a test enumerates the router and asserts that every handler has a schema.

### 2.3 Response envelope

```ts
type IpcResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: ErrorCode; message: string; details?: unknown };
    };

type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "MEDIA_MISSING"
  | "DISPLAY_UNAVAILABLE"
  | "LIVE_SESSION_ACTIVE"
  | "IO_ERROR"
  | "INTERNAL";
```

### 2.4 Audience channel

The main process creates a `MessageChannelMain` per audience window and transfers `port2` to it with `webContents.postMessage('engine:port', null, [port2])`. All live traffic uses this port rather than `ipcRenderer`. That gives lower latency, no channel-name surface, and a single ordered stream.

Command shape:

```ts
type EngineCommand =
  | { seq: number; type: "load"; doc: EngineDocument; startSlide: number }
  | {
      seq: number;
      type: "goto";
      slideIndex: number;
      transition?: TransitionSpec;
    }
  | { seq: number; type: "patch"; slideId: string; slide: EngineSlide }
  | { seq: number; type: "blank" | "logo" | "clear" | "unblank" }
  | {
      seq: number;
      type: "video";
      action: "play" | "pause" | "stop" | "seek" | "volume" | "mute";
      value?: number;
    }
  | { seq: number; type: "overlay:push"; doc: EngineDocument }
  | { seq: number; type: "overlay:pop" };
```

The engine keeps `lastAppliedSeq`. Any command with `seq <= lastAppliedSeq` is acknowledged and dropped.

**As implemented (Phases 2–3).** The schemas live in `@cmp/shared-validation/engine-protocol` and are shared by main, the engine and the IPC registry. The command set differs from the sketch above in these ways:

- `blank`/`logo`/`unblank` became one `{ type: "mask", mask: "none" | "black" | "logo" }`.
- `clear` carries `{ on }`.
- `config` was added, carrying the fallback background, logo, safe area and default transition.
- `test-pattern { on }` and `unload` were added.
- `video` gained a `toggle` action.

The engine reports back on the same port: `{ type: "state", state }` (slide, mask, overlay depth, video position, warnings), plus `{ type: "replay" }` when an operator-side engine mounts late.

- **Coalescing:** a `goto` immediately followed by another `goto` or `load` is skipped.
- **Instant commands:** `mask`, `clear` and `test-pattern` never wait behind slide rendering. Video commands do wait, but only while a load is pending.
- **Two engine sinks:** every audience window and the operator's in-app mirror is a "sink" with its own `seq`, and each is fully replayed when it (re)connects.

---

## 3. Live presentation lifecycle

Diagram: [`03-live-presentation-lifecycle.dot`](diagrams/src/03-live-presentation-lifecycle.dot)

### 3.1 Session state machine

```
idle ──services:start──▶ preparing ──engine ready──▶ live
live ──blank/logo──▶ masked ──unblank──▶ live
live ──overlay:push──▶ overlay ──overlay:pop──▶ live
live|masked|overlay ──display removed──▶ suspended ──display restored──▶ (previous state)
any ──live:end──▶ ended
any ──crash──▶ (on relaunch) recoverable ──resume──▶ preparing
```

### 3.2 Resolution: service to engine documents

`services:start` loads the service and its items in order and resolves each one:

| `item_type`       | Resolution                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `presentation`    | Load slides and objects. Map asset IDs to `cmp-media://` URLs.                                                       |
| `song`            | Run the [lyrics-to-slides pipeline](#5-lyrics-to-slides-pipeline) with the item's arrangement and template override. |
| `scripture`       | Resolve the reference to verses, then paginate into Bible slides ([§6](#6-bible--quick-scripture)).                  |
| `video` / `image` | A single full-bleed media slide (loop and mute flags taken from item options).                                       |
| `countdown`       | A countdown slide (`targetDurationMs` or `targetTime`) plus an `onComplete` action.                                  |
| `announcement`    | An auto-advancing slide group (`duration_ms` per slide, `loop: true`).                                               |
| `blank`           | A black or logo slide.                                                                                               |

The resolved documents are cached in memory for the session. The engine receives **one item at a time** (`load`) so memory stays bounded for 2-hour services.

### 3.3 Engine internals

```
PresentationEngine
├── PresentationLoader      validates EngineDocument (Zod), migrates schema version
├── SlideRenderer
│   ├── TextRenderer        absolutely positioned DOM, CSS text-shadow/outline, auto-fit
│   ├── ImageRenderer       <img> decode() before swap
│   ├── VideoRenderer       pooled <video> elements, keyed by assetId
│   ├── ShapeRenderer
│   └── BibleRenderer       verse text + reference + translation footer
├── TransitionManager       cut | fade | dissolve (MVP); slide/zoom (Phase 2)
├── PlaybackController      video transport, auto-advance timers, countdowns
├── TimelineManager         per-slide duration_ms, announcement loops
├── MediaResolver           assetId → URL, fallback background on error
└── OutputController        letterbox/scale canvas to output resolution, safe areas
```

**Double buffering**: the engine keeps two layers, `front` (visible) and `back` (next slide). After every `goto` it pre-renders slide `n+1` into `back`, awaits `img.decode()`, and sets `video.preload='auto'` with a seek to the first frame. `next` then becomes a layer swap plus a CSS transition, which keeps the target under 50 ms.

**Background continuity**: if consecutive slides share the same background `assetId` (common for songs), the `<video>` element is _moved_, not reloaded, so the motion background never hitches between lyric slides.

**Failure handling**: a media `error` event triggers a substitute `settings.fallbackBackground` (solid colour or logo), emits `engine:state { warning: 'MEDIA_FAILED', assetId }`, and continues. The audience never sees a broken-image icon.

### 3.4 Operator live workspace

The layout has seven areas: current slide (large) · audience output mirror · next slide · item playlist (left) · slide thumbnails strip · media transport bar · quick panel (Scripture / Songs / Media) · display status chip · **BLACK**, **LOGO** and **CLEAR** buttons, which stay visible at all times.

### 3.5 Keyboard shortcuts (defaults, configurable)

| Key                   | Action                                          |
| --------------------- | ----------------------------------------------- |
| → / PageDown / Space* | Next slide                                      |
| ← / PageUp            | Previous slide                                  |
| ↓ / ↑                 | Next / previous service item                    |
| B                     | Toggle black screen                             |
| L                     | Toggle logo screen                              |
| C                     | Clear text layer (keep background)              |
| K                     | Play / pause focused video                      |
| Ctrl/Cmd+F            | Quick Scripture                                 |
| Esc                   | Pop overlay (first press) / exit live (confirm) |
| 1–9 then Enter        | Go to slide N                                   |

\* Space means play/pause when the video transport has focus. Shortcuts are disabled whenever focus is in a text input, `contenteditable` element or dialog. Presentation clickers send PageDown/PageUp, so they work out of the box.

### 3.6 Live edits

A lyric fix in the live view triggers `songs:update`, which re-runs the slide generation for that song, diffs it against the cached slides, and sends `live:patch` for each changed slide. If the current slide changed, the engine swaps its text layer in place (no transition) and keeps the video running.

As implemented (Phase 5), the main process sends the engine `patch` command directly to every engine; there is no `live:patch` IPC channel. When the slide ids change (sections added or removed), the item reloads at the nearest slide and any overlays are re-pushed. Each playlist item carries a `revision` in `live:state`, so operator previews refetch. Until Phase 8 services, songs join a live session with `live:queueSong`.

---

## 4. Display management & recovery

Diagram: [`04-display-management.dot`](diagrams/src/04-display-management.dot)

### 4.1 Detection & selection

1. `screen.getAllDisplays()` provides `id`, `bounds`, `workArea`, `scaleFactor`, `label` (where available) and `internal`.
2. **Identify**: a transient frameless window on every display shows a large number and the resolution.
3. The operator assigns the audience display. The app stores a `display_profiles` row with a fingerprint `hash(label|width|height|scaleFactor)` and the output resolution (default 1920×1080).
4. **Test pattern**: the operator can project a grid, safe-area box, colour bars and a sample lyric slide to check overscan before the service.

### 4.2 Audience window placement

```ts
new BrowserWindow({
  x: d.bounds.x,
  y: d.bounds.y,
  width: d.bounds.width,
  height: d.bounds.height,
  frame: false,
  fullscreen: true,
  backgroundColor: "#000000",
  skipTaskbar: true,
  focusable: false,
  show: false,
  autoHideMenuBar: true,
  webPreferences: {/* §2.1 */},
});
```

On macOS, `fullscreen` on a secondary display uses `simpleFullscreen` to avoid Spaces animations, and `app.dock` focus is never stolen. The window is shown only after `ready-to-show`, so it never flashes white.

### 4.3 Hot-plug

| Event                                            | Behaviour                                                                                                                                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `display-removed` (the audience display)         | Close the audience window (it is recreated, not moved, on restore), keep the session state alive, set the session to `suspended`, show a red banner "Projector disconnected. Output paused." Operator previews keep working. |
| `display-added` matching the profile fingerprint | Re-position, re-fullscreen, re-show, replay `load` + `goto(current)` from the journal, then resume the previous state.                                                                                                       |
| `display-added` with no match                    | Toast "New display detected. Use as audience screen?"                                                                                                                                                                        |
| `display-metrics-changed`                        | Recompute bounds and the OutputController scale. No reload.                                                                                                                                                                  |
| Only one display                                 | Preview mode: the audience output renders in a resizable in-app panel, and "Go live" warns that there is no external screen.                                                                                                 |

### 4.4 Phase 2: multiple outputs

`display_profiles` gains `role` (`main`, `stage`, `foyer`, `stream`) and each live session gets N audience windows, each with its own _look_ (for example, the stage display shows current and next lyrics plus a clock). The command bus already carries `seq` per window, so this needs no protocol change.

---

## 5. Lyrics-to-slides pipeline

Diagram: [`05-lyrics-to-slides.dot`](diagrams/src/05-lyrics-to-slides.dot)

### 5.1 Inputs

- `songs` plus `song_sections` (`section_type`: intro, verse, pre_chorus, chorus, bridge, refrain, tag, outro; `label` such as "Verse 2").
- `song_arrangements`: an ordered list of section IDs, for example `V1 C V2 C B C C`. The default arrangement is the section order.
- Split options: `mode: 'lines' | 'chars'`, `linesPerSlide` (default 2), `maxCharsPerSlide` (default 120), and `blankBetweenSections`.
- Template: text box rect, font, size, min size, line height, alignment, and background asset.

### 5.2 Algorithm

1. **Parse** the pasted text. Header lines like `Verse 1:`, `Chorus`, `[Bridge]` and `V1` start sections, and blank lines separate stanzas inside a section.
2. **Expand** the arrangement into a section sequence. A repeated chorus reuses the same slide objects, so an edit to the chorus updates every occurrence.
3. **Split** each section into chunks by line count or a char budget. Never split mid-line, and prefer splitting at stanza breaks.
4. **Fit**: measure the text with an off-screen canvas `measureText` using the template font, and shrink from `fontSize` towards `minFontSize`. If it still overflows, split the chunk again.
5. **Emit** `EngineSlide[]` with `meta: { songId, sectionId, sectionLabel, chunkIndex }`. The operator's thumbnail strip groups slides by section label so they can jump to "Chorus" in one click.
6. **Copyright footer**: if `settings.showSongCopyright` is set, the first and last slide get a small footer with "Title · Author · © Owner · CCLI #licence".

### 5.3 Search

`songs_fts` is an FTS5 virtual table over `title`, `artist`, `lyrics_plain` and `tags`, with the `unicode61 remove_diacritics 2` tokenizer so Yoruba, Igbo and Hausa diacritics match unaccented queries. Ranking uses `bm25(songs_fts, 10.0, 3.0, 1.0, 2.0)`, so title matches outrank lyric matches.

**As implemented (Phase 5).**

- **Search table.** `songs_fts` is a regular (content-storing) FTS5 table with an UNINDEXED `song_id` column. That makes the effective weights `bm25(songs_fts, 0, 10, 3, 1, 2)` and lets `snippet()` return lyric excerpts. The repository rewrites the row on every save.
- **Query syntax.** Every word of a query must match as a prefix. Each word is quoted, so FTS operators typed by users are inert.
- **Measuring.** Step 4 does not use an off-screen canvas. Songs are generated in the main process, for the live session and the editor preview alike (`songs:preview`), so preview and projector split identically. Main has no canvas, so `@cmp/import-export` estimates width from per-character advance widths of a typical UI sans, erring wide. The engine's DOM auto-fit remains the safety net on screen.
- **Slide ids.** Ids are `<sectionId>~<chunk>~<occurrence>`, which keeps them stable under edits to other sections. Step 5's `meta` is carried on `EngineSlide.meta`.
- **Layouts.** Templates are three built-in lyric layouts (classic, lower third, bold capitals) until the Phase 7 template system.

---

## 6. Bible & Quick Scripture

Diagram: [`06-quick-scripture.dot`](diagrams/src/06-quick-scripture.dot)

### 6.1 Translation packages

A Bible translation is installed from a `.cmpbible` package: a zip with `manifest.json` (`code`, `name`, `language`, `licence`, `attribution`, `versification`, `checksum`) and `verses.jsonl`. The importer also converts OSIS, USFM and Zefania XML. The bundled translations are public domain only, for example KJV, WEB, and public-domain Yoruba and Hausa Bibles where they exist. Any other translation must be imported by the church under its own licence. See [EXTERNAL_INTEGRATIONS.md §4](EXTERNAL_INTEGRATIONS.md#4-bible-translation-licensing--packages).

The Bible module installs local packages. To prepare a package, provide a JSON manifest with
`code`, `name`, `language`, `licence`, `attribution` and `versification`. The converter computes
the SHA-256 checksum of `verses.jsonl`. Run it from the repository root with Info-ZIP on your path.

```sh
node packages/import-export/scripts/prepare-bible.mjs osis manifest.json translation.cmpbible bible.xml
```

Use `usfm` with one or more book files, or `zefania` with a Zefania XML file. Each JSONL row identifies
a `book`, numeric `chapter` and `verse`, and `text`. It can also supply `aliases` for the book.
Compound verse identifiers require normalizing the source versification before conversion.

### 6.2 Reference parser

The parser accepts `John 3:16`, `jn 3 16`, `Jn3:16-18`, `1 Cor 13:4-7`, `Ps 23`, `Romans 8:28-9:2` and `Gen 1:1, 3, 5-7`. Book names resolve through `bible_book_aliases` (seeded with English abbreviations and localised names per translation). The output is a list of `{ bookId, chapter, verseStart, verseEnd }` ranges, validated against the translation's versification.

### 6.3 Text search

`bible_verses_fts` (FTS5) is scoped by `translation_id`. Results show reference and snippet with `highlight()`.

### 6.4 Pagination

The verses are measured into the scripture template (same fitting as §5.2). A range that overflows becomes several slides, and the reference reads `Romans 8:28–30 (1/2)`. The setting "one verse per slide" overrides this.

### 6.5 Quick Scripture flow (Journey 5)

1. Ctrl/Cmd+F opens the overlay search, focused on a single input.
2. Typing shows parsed references and FTS results live, with a translation selector (default: workspace setting).
3. Enter previews the passage in the _preview_ engine.
4. Display (Enter again) sends `live:overlayPush`. The controller snapshots `{ itemIndex, slideIndex, videoTime }`, and the engine renders the scripture slides on an overlay layer above the playlist.
5. Esc or "Return" sends `live:overlayPop`, and the engine restores the exact snapshot (the video resumes from where it was).
6. "Add to service" optionally appends the scripture as a permanent service item.

---

## 7. Media import pipeline

Diagram: [`07-media-import.dot`](diagrams/src/07-media-import.dot)

1. **Intake**: drag-and-drop or a file picker. Paths are passed to the main process (the renderer never reads files).
2. **Validate**: extension and magic-byte sniffing against the supported list (images: PNG/JPG/WebP/GIF; video: MP4 H.264/HEVC*, WebM, MOV (H.264); audio: MP3/WAV/AAC/M4A; docs: PDF/PPTX; fonts: TTF/OTF).
3. **Hash**: stream SHA-256 in the worker. If the checksum already exists in `media_assets`, return the existing asset ("Already in library") with no copy.
4. **Copy**: write to `media/<h[0..2]>/<h>.<ext>.tmp`, fsync, then rename. The import is atomic.
5. **Probe**: ffprobe gives duration, dimensions, codec and has-audio. Unsupported codecs are flagged `needs_transcode` with an offer to transcode to H.264 MP4 using the bundled ffmpeg.
6. **Thumbnail**: images resize to 320 px WebP. Videos get a poster frame at 10% of their duration plus an optional 3 s hover-preview strip.
7. **Persist**: a `media_assets` row plus folder, tags and licence (source, attribution, terms).
8. **Missing-file scan** (startup and on demand): verifies that every `file_path` exists and its size matches. Missing assets are badged, and slides that use them render the fallback background.

GIF strategy: GIFs under 5 MB render as `<img>`. Larger GIFs are offered conversion to looping MP4 for smooth playback.

**As implemented (Phase 4).**

- **Where the work runs.** Steps 2–6 run in the `utilityProcess` worker (`apps/desktop/electron/worker`, using `@cmp/media-processing`); the worker never opens the database. Main persists the results and reports each file as imported, duplicate ("Already in library") or failed.
- **Single-pass copy.** Hashing happens _while_ copying, to `media/.import-<uuid>.tmp`, followed by fsync and rename. The file is read once. A duplicate's temp copy is dropped.
- **Thumbnails.** They are content-addressed as `thumbs/<sha256>.webp` (JPEG when the ffmpeg build lacks libwebp) and served at `cmp-media://thumb/<assetId>`, confined to `thumbs/` like assets are to `media/`.
- **Playback advice.** Unplayable codecs and GIFs over 5 MB are stored as `transcode_reason`, and HEVC as `playback_warning`. Conversion creates a new "(MP4)" asset next to the original.
- **Missing scan.** It runs at start-up and on demand ("Check files").
- **Delete protection.** Deleting is refused with `CONFLICT { usedBy }` while the church logo, the logo screen or any presentation slide references the asset.
- **Not yet implemented.** The optional 3 s hover strip is not generated: the library plays the file itself, muted, on hover.

\* HEVC playback depends on OS hardware decode support, so the importer warns where it isn't available.

---

## 8. Service planning

Diagram: [`08-service-planner.dot`](diagrams/src/08-service-planner.dot)

### 8.1 Polymorphic service items

```sql
service_items(
  id, service_id, group_id NULL, position,
  item_type TEXT CHECK (item_type IN ('presentation','song','scripture','video','image',
                                      'countdown','announcement','blank','camera_placeholder')),
  ref_id TEXT NULL,             -- presentation/song/media id (NULL for scripture/countdown/blank)
  options_json TEXT NOT NULL,   -- validated per item_type by Zod discriminated union
  notes TEXT, created_at, updated_at
)
```

Integrity: SQLite cannot put a foreign key on a polymorphic `ref_id`, so the repository validates existence on write. Deleting a song, presentation or media asset that a service references is blocked with a list of the referencing services ("Used in 3 services. Remove from services first or archive instead."). Archived content stays resolvable.

Example `options_json`:

```json
{ "type": "song", "arrangementId": "arr_1", "templateId": "tpl_worship", "backgroundAssetId": null }
{ "type": "scripture", "translation": "KJV", "reference": "John 3:16-21", "onePerSlide": false }
{ "type": "countdown", "durationMs": 600000, "backgroundAssetId": "as_9", "onComplete": "next_item", "chime": true }
{ "type": "announcement", "slideIds": ["..."], "durationMs": 8000, "loop": true }
```

### 8.2 Workflow (Journey 3)

Create a service, pick a template (Sunday service, Bible study, prayer meeting, communion, wedding, funeral, conference, youth or custom), add songs, scripture, presentations and announcements, drag to reorder (`position` is rewritten in one transaction), preview the whole programme in the preview engine, and save. **Duplicate** copies the items with the same refs, so the operator only swaps what changed.

### 8.3 Service templates

`service_templates.definition_json` holds an ordered list of placeholder items (`{ item_type, label, defaults }`). Instantiating it creates real `service_items` with empty refs that the operator fills in.

### 8.4 Countdown & announcements

- Countdown: the engine computes the remaining time from `performance.now()` against a start timestamp from the main process (drift-free, survives slide switches) and renders `mm:ss` or `hh:mm:ss`. On zero it fires the chime (optional) and then `onComplete` (`next_item`, `hold`, or `logo`).
- Announcements: the TimelineManager auto-advances with `duration_ms`. Any manual operator command pauses the auto-advance until the operator resumes it.

---

## 9. Offline-first, backup & crash recovery

Diagram: [`09-backup-recovery.dot`](diagrams/src/09-backup-recovery.dot)

### 9.1 Database settings

`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;`

### 9.2 Migrations

Drizzle-kit generates SQL files under `packages/database/migrations`. At startup the app:

1. Reads `app_migrations`.
2. If there are pending migrations, takes an automatic backup into `<userData>/backups/pre-migrate-<version>-<ts>.cmpbackup` (db only, no media).
3. Applies the migrations in one transaction.
4. On failure, rolls back, shows a "Could not upgrade your workspace. Your data is safe." dialog, and offers to restore or contact support.

### 9.3 Workspace backup (`.cmpbackup`)

Zip layout:

```
manifest.json      { format: "cmp.backup/v1", appVersion, churchId, createdAt,
                     db: { file, sha256 }, media: [{ assetId, path, sha256, size }] }
workspace.db       // SQLite online backup API (consistent snapshot while app runs)
media/…            // only referenced assets (option: include unreferenced)
thumbs/…           // optional, regenerable
```

Restore: unzip to a temp dir, verify every SHA-256, open the db read-only and check `PRAGMA integrity_check`, then atomically rename the current workspace to `workspace.bak-<ts>` and move the restored one in, then reload. Scheduled backups (weekly by default, keeping the last 4) run only when no live session is active.

### 9.4 Live session journal

`live_sessions` is updated (debounced to 250 ms, flushed on every item change) with `current_item_id`, `current_slide_index`, `overlay_stack_json`, `playback_state_json` (`{ assetId, timeMs, paused, muted }`) and `heartbeat_at`. On launch, a session with `ended_at IS NULL` triggers the prompt **"Resume 'Sunday Service' at Praise & Worship, slide 3?"** Resume re-runs `services:start` with `startAt`.

### 9.5 Internet failure (Journey 6)

Nothing in the presentation path performs network I/O, and a CI check enforces it: a Playwright E2E test runs a full service with the network disabled through `session.enableNetworkEmulation({ offline: true })`. When offline, the Downloads module and update checks are disabled and nothing else changes.

### 9.6 Presentation versions

Every save writes a `presentation_versions` snapshot (`snapshot_json` in `cmp.presentation/v1` format). The last 20 are kept per presentation, which gives restore-previous-version and is the same format used for `.cmppres` import and export. Imported documents create a new presentation.
Workspace media is referenced by asset ID. The destination workspace needs those same asset IDs to render
referenced media.

---

## 10. Content catalogue & media packs (post-MVP)

Diagram: [`10-content-catalogue.dot`](diagrams/src/10-content-catalogue.dot)

- **Cloud API (NestJS, port 4000)**: `GET /v1/catalogue/packs`, `GET /v1/catalogue/packs/:id` (manifest), and `POST /v1/catalogue/packs/:id/download-url`, which returns a signed R2 URL valid for 15 min.
- **Pack manifest**: `{ id, name, version, category, sizeBytes, licence: { type, attribution, redistribution: false }, assets: [{ assetId, sha256, mime, path, width, height, durationMs }] }`.
- **Desktop download**: a resumable HTTP range download into `downloads/<packId>.part`. It verifies the pack signature (Ed25519, public key pinned in the app) and every asset SHA-256, then imports through the [§7 pipeline](#7-media-import-pipeline). Rows go into `download_packages` and `downloaded_assets`, and `media_licences` is populated from the manifest.
- **Content governance**: only content with a written redistribution licence is published. Contributor uploads (Phase 4) go through BullMQ jobs that scan, transcode, thumbnail, wait for human review, and then publish.
- **Optional sync** (Phase 4): a per-entity `updated_at` plus a tombstone change log, last-writer-wins for metadata, and media uploaded by checksum (so it is never re-uploaded). It is opt-in per workspace and never runs during a live session.

---

## 11. IPC & API reference

All channels return the [§2.3 envelope](#23-response-envelope). Schemas live in `packages/shared-validation/src/ipc/*.ts`. The contracts below are representative examples, not a final specification.

### Presentations — `presentations:*`, `slides:*`

| Channel                   | Input                                                                                       | Output                                    |
| ------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `presentations:create`    | `{ title, description?, aspectRatio: '16:9'\|'4:3'\|'custom', width, height, templateId? }` | `{ id, title, slideCount, createdAt }`    |
| `presentations:get`       | `{ id }`                                                                                    | Full presentation with slides and objects |
| `presentations:list`      | `{ query?, favourite?, limit, cursor? }`                                                    | `{ items, nextCursor }`                   |
| `presentations:update`    | `{ id, patch }`                                                                             | Updated presentation                      |
| `presentations:duplicate` | `{ id }`                                                                                    | New presentation                          |
| `slides:create`           | `{ presentationId, slideType, position, background, objects[] }`                            | Slide                                     |
| `slides:reorder`          | `{ presentationId, orderedIds[] }`                                                          | `{ ok: true }`                            |

`slides:create` example:

```json
{
  "presentationId": "pres_01J…",
  "slideType": "text",
  "position": 0,
  "background": { "type": "color", "value": "#101820" },
  "objects": [
    {
      "type": "text",
      "content": "GOD IS FAITHFUL",
      "frame": { "x": 160, "y": 380, "w": 1600, "h": 320 },
      "style": {
        "fontFamily": "Inter",
        "fontSize": 96,
        "fontWeight": 700,
        "color": "#FFFFFF",
        "align": "center",
        "shadow": "0 4px 16px #0008"
      }
    }
  ]
}
```

### Songs — `songs:*`

| Channel                | Input                                                                                 | Output                                                     |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `songs:create`         | `{ title, artist?, language, sections[], copyright?, tags[] }`                        | Song                                                       |
| `songs:search`         | `{ query, language?, collectionId?, limit=20 }`                                       | `[{ id, title, artist, language, sectionCount, snippet }]` |
| `songs:generateSlides` | `{ songId, arrangementId?, split: { mode, linesPerSlide?, maxChars? }, templateId? }` | `EngineSlide[]`                                            |
| `songs:importFile`     | `{ path, format: 'txt'\|'openlyrics'\|'ccli' }`                                       | Song[]                                                     |

As implemented (Phase 5), the channels are `songs:list` (search, collection and language filters), `get`, `create`, `update`, `delete`, `parseLyrics`, `preview` (generates slides for an unsaved draft), `import` (`{ paths? }`; without paths it opens a picker, and the format is detected from content), `collections`, `createCollection` and `templates`. Song files are parsed in the utility worker. OpenLyrics input with a DOCTYPE or ENTITY declaration is refused.

### Bible — `bible:*`

| Channel                | Input                                               | Output                                              |
| ---------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `bible:translations`   | —                                                   | `[{ id, code, name, language, licence }]`           |
| `bible:lookup`         | `{ translation: 'KJV', reference: 'John 3:16-18' }` | `{ reference, translation, verses: [{ v, text }] }` |
| `bible:search`         | `{ translation, query, limit }`                     | `[{ reference, snippet }]`                          |
| `bible:installPackage` | `{ path }`                                          | Translation                                         |

### Media — `media:*`

| Channel             | Input                                                     | Output                                                             |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| `media:import`      | `{ paths[], folderId?, tags[]?, licence? }`               | `{ jobId }`, then `job:progress` events and finally `MediaAsset[]` |
| `media:list`        | `{ folderId?, type?, tag?, query?, favourite?, cursor? }` | Paged assets                                                       |
| `media:delete`      | `{ id }`                                                  | Error `CONFLICT` with `{ usedBy[] }` if the asset is referenced    |
| `media:scanMissing` | —                                                         | `{ missing: assetId[] }`                                           |

Also implemented: `media:get` (detail with licence and `usedBy`), `media:chooseAndImport`, `media:cancelJob`, `media:update`, `media:setTags`, `media:setLicence`, `media:transcode`, `media:folders` / `createFolder` / `renameFolder` / `deleteFolder`, `media:tags`. Push events: `jobs:progress` and `media:changed`. Dropped files reach main as paths through `window.cmp.files.pathFor(file)` (Electron `webUtils`); the renderer never reads them.

### Services & Live — `services:*`, `live:*`

| Channel                                   | Input                                                           | Output                                                             |
| ----------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `services:create`                         | `{ title, serviceDate, startTime?, templateId? }`               | Service                                                            |
| `services:duplicate`                      | `{ id, serviceDate }`                                           | Service                                                            |
| `services:start`                          | `{ serviceId, displayId, startAt?: { itemIndex, slideIndex } }` | `{ sessionId, status: 'ready', currentItem: 0 }`                   |
| `live:next` / `live:prev`                 | —                                                               | `{ itemIndex, currentSlide, totalSlides, status: 'live' }`         |
| `live:goto`                               | `{ slideIndex }`                                                | Same                                                               |
| `live:itemGoto`                           | `{ itemIndex }`                                                 | Same                                                               |
| `live:blank` / `live:logo` / `live:clear` | `{ on: boolean }`                                               | `{ status }`                                                       |
| `live:video`                              | `{ action, value? }`                                            | `{ playback }`                                                     |
| `live:overlayPush`                        | `{ kind: 'scripture'\|'media'\|'song', payload }`               | `{ overlayDepth }`                                                 |
| `live:overlayPop`                         | —                                                               | `{ overlayDepth }`                                                 |
| `live:end`                                | —                                                               | `{ endedAt }`                                                      |
| push `live:state`                         | —                                                               | `{ sessionId, status, itemIndex, slideIndex, video?, warnings[] }` |

### Displays — `displays:*`

`displays:list` → `[{ id, label, width, height, scaleFactor, primary, assigned }]` · `displays:identify` · `displays:assign { displayId, resolution? }` · `displays:testPattern { on }` · push `displays:changed`.

### Backup — `backup:*`

`backup:create { includeUnreferenced?: boolean, destination }` → `{ jobId }` · `backup:restore { path }` (rejected with `LIVE_SESSION_ACTIVE` during a live session) · `backup:list`.

### Optional Cloud API — port 4000 (post-MVP)

`POST /v1/auth/token` (device-code login) · `GET /v1/catalogue/packs` · `GET /v1/catalogue/packs/:id` · `POST /v1/catalogue/packs/:id/download-url` · `POST /v1/sync/push` · `GET /v1/sync/pull?since=`. JWT access token (15 min) plus a rotating refresh token stored in the OS keychain via `safeStorage`.

---

## 12. Data model

Diagram: [`11-data-model.dot`](diagrams/src/11-data-model.dot)

All IDs are ULIDs stored as `TEXT`, and all timestamps are ISO-8601 UTC `TEXT`. Representative DDL:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE churches (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, logo_asset_id TEXT,
  default_language TEXT DEFAULT 'en', default_translation_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT,
  pin_hash TEXT,                       -- optional local PIN (argon2id), no passwords in MVP
  created_at TEXT NOT NULL
);

CREATE TABLE church_members (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'media_operator'
    CHECK (role IN ('owner','media_admin','media_operator','content_editor','viewer')),
  created_at TEXT NOT NULL, UNIQUE (church_id, user_id)
);

CREATE TABLE media_folders (
  id TEXT PRIMARY KEY, church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES media_folders(id) ON DELETE CASCADE, name TEXT NOT NULL
);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES media_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL, original_name TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('image','video','audio','document','font')),
  category TEXT,                        -- motion_background, gospel_video, flyer, logo, ...
  mime_type TEXT, file_path TEXT NOT NULL,   -- RELATIVE to workspace media dir
  file_size INTEGER DEFAULT 0, checksum TEXT NOT NULL,
  duration_ms INTEGER, width INTEGER, height INTEGER, codec TEXT,
  thumbnail_path TEXT, is_favourite INTEGER DEFAULT 0, is_missing INTEGER DEFAULT 0,
  archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (church_id, checksum)
);

CREATE TABLE media_tags (id TEXT PRIMARY KEY, church_id TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(church_id, name));
CREATE TABLE media_asset_tags (asset_id TEXT REFERENCES media_assets(id) ON DELETE CASCADE,
                               tag_id TEXT REFERENCES media_tags(id) ON DELETE CASCADE,
                               PRIMARY KEY (asset_id, tag_id));
CREATE TABLE media_licences (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
                             licence_type TEXT NOT NULL, source TEXT, attribution TEXT, terms TEXT);

CREATE TABLE presentations (
  id TEXT PRIMARY KEY, church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT,
  aspect_ratio TEXT DEFAULT '16:9', width INTEGER DEFAULT 1920, height INTEGER DEFAULT 1080,
  schema_version TEXT NOT NULL DEFAULT 'cmp.presentation/v1',
  is_favourite INTEGER DEFAULT 0, archived_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE slides (
  id TEXT PRIMARY KEY,
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, slide_type TEXT NOT NULL,
  background_type TEXT DEFAULT 'color' CHECK (background_type IN ('color','gradient','image','video','transparent')),
  background_value TEXT,                -- colour/gradient JSON or asset_id
  background_options_json TEXT,         -- loop, mute, blur, overlay
  transition_type TEXT DEFAULT 'cut', transition_ms INTEGER DEFAULT 0,
  duration_ms INTEGER, notes TEXT, created_at TEXT NOT NULL,
  UNIQUE (presentation_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE slide_objects (
  id TEXT PRIMARY KEY, slide_id TEXT NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK (object_type IN ('text','image','video','shape','bible','countdown')),
  z_index INTEGER DEFAULT 0, properties_json TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE presentation_versions (
  id TEXT PRIMARY KEY, presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (presentation_id, version)
);

CREATE TABLE songs (
  id TEXT PRIMARY KEY, church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title TEXT NOT NULL, artist TEXT, language TEXT DEFAULT 'en', category TEXT,
  copyright_owner TEXT, copyright_year INTEGER, ccli_number TEXT, licence_reference TEXT,
  default_background_asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  default_template_id TEXT, archived_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE song_sections (
  id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL, label TEXT NOT NULL, section_order INTEGER NOT NULL, lyrics TEXT NOT NULL
);

CREATE TABLE song_arrangements (
  id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, section_ids_json TEXT NOT NULL, is_default INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE songs_fts USING fts5(
  title, artist, lyrics_plain, tags, content='', tokenize='unicode61 remove_diacritics 2'
);  -- maintained by triggers / repository on write; rowid ↔ songs via songs_fts_map

CREATE TABLE bible_translations (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, language TEXT NOT NULL,
  versification TEXT DEFAULT 'kjv', licence TEXT NOT NULL, attribution TEXT, installed_at TEXT NOT NULL
);
CREATE TABLE bible_books (
  id TEXT PRIMARY KEY, translation_id TEXT NOT NULL REFERENCES bible_translations(id) ON DELETE CASCADE,
  osis_id TEXT NOT NULL, name TEXT NOT NULL, testament TEXT, book_order INTEGER NOT NULL,
  chapter_count INTEGER NOT NULL, UNIQUE (translation_id, osis_id)
);
CREATE TABLE bible_book_aliases (
  book_id TEXT NOT NULL REFERENCES bible_books(id) ON DELETE CASCADE, alias TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (book_id, alias)
);
CREATE TABLE bible_verses (
  id INTEGER PRIMARY KEY,
  translation_id TEXT NOT NULL REFERENCES bible_translations(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES bible_books(id) ON DELETE CASCADE,
  chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL,
  UNIQUE (translation_id, book_id, chapter, verse)
);
CREATE VIRTUAL TABLE bible_verses_fts USING fts5(text, content='bible_verses', content_rowid='id',
                                                 tokenize='unicode61 remove_diacritics 2');

CREATE TABLE templates (
  id TEXT PRIMARY KEY, church_id TEXT REFERENCES churches(id) ON DELETE CASCADE,  -- NULL = built-in
  name TEXT NOT NULL, category TEXT NOT NULL, width INTEGER, height INTEGER,
  definition_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE services (
  id TEXT PRIMARY KEY, church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title TEXT NOT NULL, service_type TEXT, service_date TEXT, start_time TEXT,
  theme TEXT, description TEXT, assigned_user_id TEXT REFERENCES users(id),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','ready','live','completed','archived')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE service_item_groups (id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
                                  name TEXT NOT NULL, position INTEGER NOT NULL);
-- service_items: see §8.1
CREATE TABLE service_templates (id TEXT PRIMARY KEY, church_id TEXT REFERENCES churches(id) ON DELETE CASCADE,
                                name TEXT NOT NULL, definition_json TEXT NOT NULL);

CREATE TABLE live_sessions (
  id TEXT PRIMARY KEY, church_id TEXT NOT NULL, service_id TEXT REFERENCES services(id),
  display_profile_id TEXT, current_item_id TEXT, current_slide_index INTEGER DEFAULT 0,
  overlay_stack_json TEXT DEFAULT '[]', playback_state_json TEXT,
  started_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE display_profiles (
  id TEXT PRIMARY KEY, church_id TEXT NOT NULL, name TEXT NOT NULL, fingerprint TEXT NOT NULL,
  role TEXT DEFAULT 'main', width INTEGER NOT NULL, height INTEGER NOT NULL, UNIQUE(church_id, fingerprint)
);

CREATE TABLE download_packages (id TEXT PRIMARY KEY, name TEXT, version TEXT, manifest_json TEXT, installed_at TEXT);
CREATE TABLE downloaded_assets (id TEXT PRIMARY KEY, package_id TEXT REFERENCES download_packages(id) ON DELETE CASCADE,
                                asset_id TEXT REFERENCES media_assets(id) ON DELETE CASCADE);
CREATE TABLE backup_records (id TEXT PRIMARY KEY, file_path TEXT, kind TEXT, created_at TEXT, status TEXT, size_bytes INTEGER);
CREATE TABLE settings (church_id TEXT, key TEXT, value_json TEXT NOT NULL, PRIMARY KEY (church_id, key));
CREATE TABLE activity_logs (id TEXT PRIMARY KEY, user_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT, created_at TEXT);
CREATE TABLE app_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
```

Key relationships: one church has many presentations, songs, media, services and templates. A presentation has many slides, and a slide has many slide_objects. A song has many sections and arrangements. A translation has many books and verses (all scoped by `translation_id`). A service has many groups and items, and each item points polymorphically to one entity. A live session points to one service.

Indexes: `slides(presentation_id, position)`, `service_items(service_id, position)`, `media_assets(church_id, category)`, `media_assets(checksum)`, `bible_verses(translation_id, book_id, chapter)`, `live_sessions(ended_at)`.

---

## 13. Filesystem & settings key catalog

### Filesystem

| Path (under `app.getPath('userData')`)                  | Purpose                                                  |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `config.json`                                           | Active workspace ID, window bounds, last display profile |
| `workspaces/<churchId>/workspace.db` (+ `-wal`, `-shm`) | SQLite                                                   |
| `workspaces/<churchId>/media/<aa>/<sha256>.<ext>`       | Content-addressed media                                  |
| `workspaces/<churchId>/thumbs/<sha256>.webp`            | Thumbnails and posters (content-addressed, Phase 4)      |
| `workspaces/<churchId>/fonts/`                          | Imported fonts (registered via `FontFace` at runtime)    |
| `downloads/`                                            | Partial pack downloads                                   |
| `backups/`                                              | Automatic and scheduled backups                          |
| `logs/main.log`, `logs/renderer.log`                    | electron-log, 5 × 5 MB rotation                          |

### Settings keys (`settings` table)

| Key                        | Default                                | Meaning                        |
| -------------------------- | -------------------------------------- | ------------------------------ |
| `display.outputResolution` | `{ "w":1920, "h":1080 }`               | Audience render resolution     |
| `display.safeAreaPct`      | `5`                                    | Safe-area inset guide          |
| `live.fallbackBackground`  | `{ "type":"color","value":"#000" }`    | Used on media failure          |
| `live.logoAssetId`         | `null`                                 | Logo screen                    |
| `live.defaultTransition`   | `{ "type":"fade","ms":300 }`           |                                |
| `live.shortcuts`           | (defaults in §3.5)                     | Remappable                     |
| `songs.split`              | `{ "mode":"lines","linesPerSlide":2 }` |                                |
| `songs.showCopyright`      | `true`                                 | Footer on first and last slide |
| `bible.defaultTranslation` | `"KJV"`                                |                                |
| `bible.onePerSlide`        | `false`                                |                                |
| `backup.schedule`          | `{ "everyDays":7, "keep":4 }`          |                                |
| `ui.theme`                 | `"dark"`                               | `dark` / `light` / `system`    |
| `updates.channel`          | `"stable"`                             | `alpha` / `beta` / `stable`    |

---

## 14. Security & idempotency

Summary only. See [SECURITY.md](SECURITY.md) for the full hardening notes.

- Electron hardening: §2.1 configuration, CSP, navigation and new-window blocking, `cmp-media://` path confinement, no `remote` module, `@electron/fuses` (`RunAsNode` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on).
- Input validation: Zod on every IPC payload and on every imported file (PPTX XML, song files, Bible packages, backups). The zip extractor rejects `..` paths and enforces a decompression-bomb limit.
- Idempotency: `seq` on engine commands, `UNIQUE(church_id, checksum)` on media, ULIDs generated client-side so retried creates are upserts, and the backup restore is atomic rename-swap.
- Updates: signed installers, and electron-updater verifies the signature. No update installs while a live session is active.
- Licensing: Bible translations and media carry licence metadata, and redistribution flags are respected on export.
- Privacy: no telemetry without opt-in. Crash reports (opt-in) strip file paths and lyric/content text.

---

## 15. Release & distribution topology

Diagram: [`12-release-distribution.dot`](diagrams/src/12-release-distribution.dot)

```
git tag vX.Y.Z → GitHub Actions matrix
   ├── windows-latest: build → sign (Authenticode via cloud HSM / Azure Trusted Signing) → NSIS .exe
   ├── macos-14 (arm64) + macos-13 (x64) or universal: build → codesign (Developer ID) → notarytool → staple → .dmg/.zip
   └── upload artifacts + latest.yml / latest-mac.yml → GitHub Releases (and mirror to R2 CDN)
Desktop app → electron-updater → reads latest*.yml from channel feed → downloads → verifies → installs on quit
```

Channels are `alpha` (internal), `beta` (5–10 pilot churches) and `stable` (public). Staged rollout uses `stagingPercentage` in `latest.yml`. Step-by-step setup: [HOSTING.md](HOSTING.md), [EXTERNAL_INTEGRATIONS.md](EXTERNAL_INTEGRATIONS.md), and rollback in [RUNBOOK.md](RUNBOOK.md).

---

## 16. Repository layout

See [ARCHITECTURE.md §11](ARCHITECTURE.md#11-suggested-repository-layout) for the tree and the seven architectural rules. Package dependency direction:

```
apps/desktop ──▶ presentation-engine ──▶ shared-validation (engine protocol), shared-types
      │      ──▶ database ──▶ shared-types
      │      ──▶ import-export ──▶ media-processing, database, shared-validation
      └────────▶ shared-validation ──▶ shared-types
apps/api     ──▶ shared-types, shared-validation
```

`dependency-cruiser` enforces the rules in CI (for example, `presentation-engine` may not depend on `react`).

---

## 17. Product scope, roles & user journeys

### 17.1 Scope by release

| Feature                                                                      | MVP | Later   |
| ---------------------------------------------------------------------------- | --- | ------- |
| External display output, live controls, black/logo/clear                     | ✅  |         |
| Lyrics, Bible, media library, slide editor, service playlist                 | ✅  |         |
| Countdown, announcements, offline operation, PowerPoint import               | ✅  |         |
| Templates, backup/restore                                                    | ✅  |         |
| Animated transitions beyond fade, multiple independent outputs, versions UI  |     | Phase 2 |
| Live camera, livestream output, lower thirds, PiP, AI captions, phone remote |     | Phase 3 |
| Media catalogue, packs, community templates, cloud sync                      |     | Phase 4 |

### 17.2 Roles

| Role                | Permissions                                                        |
| ------------------- | ------------------------------------------------------------------ |
| Workspace Owner     | Everything, including deleting the workspace and restoring backups |
| Media Administrator | Content, users, settings                                           |
| Media Operator      | Prepare and run services and presentations                         |
| Content Editor      | Create and edit songs, slides and media. Cannot go live.           |
| Viewer              | Read-only                                                          |

The MVP ships a single local user (Owner) with an optional PIN. The role model exists in the schema from day one so multi-user support (Phase 4, with sync) needs no migration.

### 17.3 Onboarding (Journey 1)

Create workspace, enter the church name, add a logo (optional), pick the output resolution, theme, and default Bible translation, import existing media or install the sample pack, run the display test, then a 2-minute interactive tour. No account is required.

### 17.4 Journeys covered

| #   | Journey                 | Sections               |
| --- | ----------------------- | ---------------------- |
| 1   | First-time installation | §17.3, §4.1            |
| 2   | Create a presentation   | §11 Presentations, §12 |
| 3   | Prepare Sunday service  | §8                     |
| 4   | Run a live service      | §3                     |
| 5   | Unexpected Bible verse  | §6.5                   |
| 6   | Internet failure        | §9.5                   |
| 7   | Projector disconnection | §4.3                   |

### 17.5 Quality metrics

Crashes per service · video playback failure rate · p95 slide-switch latency (target < 100 ms, aim < 50 ms) · display reconnection success rate · media import failure rate · backup restore success rate · cold start time (target < 4 s) · weekly active churches. **North-star metric: successful uninterrupted services.**
