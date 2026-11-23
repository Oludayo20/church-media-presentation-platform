# Church Media & Worship Presentation Platform

A free, offline-first desktop application, like ProPresenter, EasyWorship or FreeShow, that a church media operator uses to prepare and run everything shown on church screens: worship lyrics, Bible verses, motion backgrounds, gospel videos, announcements, flyers, sermon slides, offering slides and countdowns. All of it is controlled from one operator window while a separate fullscreen audience window drives the projector or LED wall. The hard technical problem is the live presentation engine. It has to render text, images and 1080p video on an external display smoothly, keep the operator's controls off the projector, and keep working when the projector cable is pulled mid-sermon. **The defining constraint is that a Sunday service can never stop. The audience output must not freeze, block on the network, or lose its position, whatever the operator, the internet or the hardware does.**

📖 **Complete documentation (diagram-by-diagram): [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md)**
📋 **Architecture summary: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**
🌍 **External integrations, step by step: [`docs/EXTERNAL_INTEGRATIONS.md`](docs/EXTERNAL_INTEGRATIONS.md)**
✅ **Implementation task breakdown: [`docs/TASKS.md`](docs/TASKS.md)**
🚀 **Run locally / ship installers: [`docs/HOSTING.md`](docs/HOSTING.md)**

## What to build

1. **Electron main process**: window lifecycle, display detection, filesystem, SQLite lifecycle, typed and validated IPC, auto-update.
2. **Display Manager**: detects monitors, lets the operator pick the audience screen, opens a borderless fullscreen output window, and recovers when a display disconnects or reconnects.
3. **Presentation Engine** (`packages/presentation-engine`): a React-free renderer for slides, text, images, video, transitions, timeline and playback. It runs in the audience window and is driven only by operator commands.
4. **Live Control** (operator UI): current, next and audience previews, playlist, next/previous/go-to, black, logo and clear screen, video transport, Quick Scripture, and keyboard shortcuts.
5. **Presentation Editor**: a 16:9/4:3/custom canvas with text, image and video objects, backgrounds, layers, safe-area guides, templates and PowerPoint import.
6. **Song Manager**: songs with sections (verse, chorus, bridge and so on), arrangement order, automatic lyrics-to-slides, live lyric correction, collections, and FTS5 search.
7. **Bible Manager**: installable translation packages, reference and full-text search, verse ranges, favourites, scripture collections and Quick Scripture.
8. **Media Library**: import, thumbnails, folders, tags, favourites, duplicate detection by checksum, and missing-file tracking.
9. **Service Planner**: services built from polymorphic service items, service templates, duplicate-a-past-service, countdowns and announcement rotation.
10. **Import/Export Engine**: PPTX/PDF import, slide images and PDF export, and a full workspace backup and restore (`.cmpbackup`).
11. **Optional Cloud API** (`apps/api`, post-MVP): NestJS content catalogue and downloadable media packs, with optional sync. The desktop app never depends on it.

## Engineering concepts

Electron security boundary (contextIsolation · sandbox · no nodeIntegration · narrow typed preload) · Zod-validated IPC contracts shared between processes · multi-window, multi-display output with `screen` API hot-plug recovery · a UI-independent rendering engine with separate live and preview state · double-buffered slide and video preloading so transitions never reload media · offline-first SQLite (Drizzle) with migrations and versioned presentation snapshots · SQLite FTS5 full-text search over lyrics and scripture · content-addressed media storage (SHA-256) with stable asset IDs instead of absolute paths · crash-safe live-session journaling to restore position after a restart · polymorphic service items with validated entity types · PPTX parsing and best-effort layout conversion · signed and notarised Windows/macOS installers with staged auto-update · licence-aware media and Bible distribution.
