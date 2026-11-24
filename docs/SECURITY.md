# Security & Hardening Notes — Church Media & Worship Presentation Platform

The threat model of a desktop presentation app is different from a web platform. The real risks are **malicious content files** (a "worship pack" PPTX or backup shared on WhatsApp), a **compromised update**, **renderer compromise escalating to the OS**, and **licence and privacy** exposure. Availability during a service is also a security property: a crash at the altar is the incident.

## Electron process isolation

- Every window uses `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. No `remote` module, no `webviewTag`. See [DOCUMENTATION.md §2.1](DOCUMENTATION.md#21-window-security-configuration).
- The preload exposes **named functions only** through `contextBridge`. It never exposes `ipcRenderer`, `send(channel, …)` or anything that accepts a channel name from the renderer.
- Strict CSP in every HTML entry. No `unsafe-eval`, and no remote script origins.
- `setWindowOpenHandler` denies everything, `will-navigate` and `will-redirect` are blocked, and external links open through `shell.openExternal` only for an allowlist of `https:` hosts (help site, licence pages).
- The audience window has **no preload API surface** beyond receiving its `MessagePort`. It cannot call any `cmp.*` functions.
- `session.setPermissionRequestHandler` denies all permissions (camera, mic, geolocation, notifications) until the Phase 3 camera feature, which then allows `media` only, prompted per device.

## IPC input validation

- Every `ipcMain.handle` validates its payload with the shared Zod schema. Unknown keys are stripped (`.strict()` on security-relevant shapes).
- Handlers verify `event.senderFrame.url` matches the app's own `file://` / `app://` origin, which rejects messages from any unexpected frame.
- File paths from the renderer are accepted only from OS dialogs or drag-and-drop. The main process re-resolves and checks them with `fs.realpath` before reading.
- A startup self-test fails the build if any registered channel lacks a schema.

## Local media protocol confinement

- `cmp-media://asset/<assetId>` resolves via the database only. The URL never carries a path.
- The resolved path must start with the workspace `media/` realpath (symlinks resolved), otherwise the protocol returns 403.
- MIME is taken from the database record, not the extension, and `X-Content-Type-Options: nosniff` is set.

## Untrusted file import (PPTX, songs, Bibles, backups, packs)

- All zip-based formats (PPTX, `.cmpbackup`, `.cmpbible`, packs) are extracted with:
  - zip-slip protection (reject entries with `..`, absolute paths or drive letters),
  - limits on entry count, per-file size and total uncompressed size (decompression bomb: ratio > 100× or > 4 GB is rejected),
  - no symlink entries.
- XML parsing (PPTX, OpenLyrics, OSIS, Zefania) disables DTDs and external entities (XXE).
- Imported text is treated as **text**. The engine renders it with `textContent`, never `innerHTML`. Rich text uses a whitelisted span model (bold, italic, colour), not HTML.
- PPTX embedded OLE objects, macros (`.pptm`) and external links are ignored. URLs in hyperlinks are dropped.
- Parsing runs in the `utilityProcess` worker, so a parser crash cannot take down the main process or a live session.
- PPTX is read with a bounded random-access ZIP reader. Entry count, per-entry size and total uncompressed size are checked while streaming, so a lying header cannot get past them. Zip entry names are never used as file-system paths.
- PDFs are parsed by pdf.js in a hidden, sandboxed renderer under the strict CSP, not in main. pdf.js 6 never evaluates code from documents.
- Fuzz corpora for each importer run in CI ([TASKS.md Phase 10](TASKS.md#phase-10--hardening--cross-cutting)).

## Backup integrity

- `.cmpbackup` manifests carry SHA-256 for the database and every media file, and restore aborts on any mismatch.
- `PRAGMA integrity_check` runs on the restored database before the atomic swap.
- Backups are not encrypted by default (churches share them between laptops). There is an optional passphrase (AES-256-GCM, key derived with scrypt) for backups stored on shared or cloud drives.

## Update & supply-chain security

- Installers are signed (Developer ID + notarisation, and Authenticode via Trusted Signing). electron-updater verifies signatures before install. See [EXTERNAL_INTEGRATIONS.md §1–3](EXTERNAL_INTEGRATIONS.md#1-apple-developer-id-signing--notarisation).
- The update feed is HTTPS only. On Windows, `publisherName` pinning rejects updates signed by any other publisher.
- `@electron/fuses`: `RunAsNode=false`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`, `EnableCookieEncryption=true`.
- Dependencies: lockfile committed, `pnpm audit` + `osv-scanner` in CI, Renovate with a 7-day minimum release age, and no `postinstall` scripts from unvetted packages (`allowBuilds` in `pnpm-workspace.yaml`; currently nothing is allowed. SQLite is the built-in `node:sqlite`, so there is no native module to build).
- Keep Electron on a supported major (the latest three). Security patch releases are fast-tracked through beta, but not during the weekend freeze ([RUNBOOK.md](RUNBOOK.md)).
- Release signing secrets live in GitHub environment secrets with required reviewers on the `release` environment.

## Media pack signing (post-MVP)

- Each pack manifest is signed with Ed25519. The public key is compiled into the app (`CMP_PACK_PUBKEY`), and the private key lives in a KMS or secret manager and is used only by the publishing job.
- The app verifies the manifest signature and then every asset SHA-256 before import. Signed R2 download URLs expire after 15 minutes.

## Local accounts & PIN

- The MVP has no passwords. An optional workspace PIN (argon2id hash in `users.pin_hash`) gates Settings, Backup/Restore and Delete. This protects against curious congregants, not determined attackers, and the UI says so.
- Cloud tokens (post-MVP) are stored with `safeStorage.encryptString` (Keychain/DPAPI), never in SQLite or plaintext config.

## Licensing compliance

- The app never ships copyrighted Bible translations, lyrics, fonts or media without a written licence ([EXTERNAL_INTEGRATIONS.md §4–5](EXTERNAL_INTEGRATIONS.md#4-bible-translation-licensing--packages)).
- `media_licences` and `bible_translations.licence` are carried into exports. Exporting a pack-sourced asset marked `redistribution: false` is blocked, with an explanation.

## Privacy & telemetry

- No network calls happen at all unless the operator enables update checks (on by default, disclosed in onboarding) or crash reports (off by default).
- Crash reports scrub file paths, usernames, church name, lyrics, slide text and scripture text. Only stack traces, module names, OS and GPU info and the app version are sent.
- The support bundle is generated locally, previewed to the operator before saving, and excludes `workspace.db` and media unless they explicitly tick "include workspace".

## Availability as a security property

- The live engine is isolated from editor and import work (separate window, worker process for heavy jobs).
- Updates never install during a live session. Scheduled backups and migrations never run during one.
- Media failures degrade to the fallback background. A renderer crash of the audience window (`render-process-gone`) is auto-recovered: the controller recreates the window and replays `load` + `goto(current)` from the journal within 2 s.
