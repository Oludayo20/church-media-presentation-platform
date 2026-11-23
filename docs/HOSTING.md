# Hosting & Deployment Guide — Church Media & Worship Presentation Platform

This product is primarily a **desktop application**. "Production deployment" mostly means building signed installers and publishing them to an update feed. Servers are involved only for the optional cloud catalogue (post-MVP), which the app never needs in order to present.

## Application components

| Component                                            | Where it runs                              | Required for MVP     |
| ---------------------------------------------------- | ------------------------------------------ | -------------------- |
| Desktop app: main process                            | Operator's Windows/macOS computer          | ✅                   |
| Desktop app: operator renderer                       | Same, primary monitor                      | ✅                   |
| Desktop app: audience renderer                       | Same, projector or LED output              | ✅                   |
| Desktop app: utility worker (ffmpeg, import, backup) | Same                                       | ✅                   |
| SQLite workspace + media store                       | Operator's disk (`userData`)               | ✅                   |
| Update feed (GitHub Releases + R2 mirror)            | Static hosting / CDN                       | ✅ (for auto-update) |
| Product website / download page                      | Static hosting (Cloudflare Pages / Vercel) | ✅                   |
| Cloud API (NestJS) + PostgreSQL + Redis              | Docker on a VPS / managed                  | ❌ post-MVP          |
| Media pack storage (Cloudflare R2)                   | Object storage                             | ❌ post-MVP          |
| Admin dashboard (Next.js)                            | Vercel / container                         | ❌ post-MVP          |

## Prerequisites (your machine)

- Node.js 22+ (`.nvmrc`) and pnpm 12 (`corepack enable`; the version is pinned in the root `packageManager` field)
- Git
- Graphviz (`brew install graphviz`) for rendering docs diagrams
- **macOS builds:** Xcode Command Line Tools. Apple Developer account for signing (see [EXTERNAL_INTEGRATIONS.md §1](EXTERNAL_INTEGRATIONS.md#1-apple-developer-id-signing--notarisation)).
- **Windows builds:** Windows 10/11 with Visual Studio Build Tools (C++ workload) for `better-sqlite3` native rebuilds.
- A **second display** (a projector, TV or spare monitor) for real live-mode testing. Without one, the app runs in single-display preview mode.
- Docker Desktop, only if you work on the optional cloud API.

## Run locally with Docker

The desktop app cannot run inside Docker because it needs a real display and GPU. Docker is used only for the **optional cloud stack** (post-MVP).

### 1. Clone and configure

```bash
git clone <repo-url> church-media-presentation-platform
cd church-media-presentation-platform
pnpm install
cp apps/api/.env.example apps/api/.env
```

### 2. Start the full stack

```bash
docker compose -f infra/docker-compose.yml up -d     # postgres:16, redis:7, minio (R2 stand-in), api:4000
pnpm dev                                              # desktop app on the host, pointed at http://localhost:4000
```

### 3. Verify

```bash
curl http://localhost:4000/health          # {"status":"ok"}
curl http://localhost:4000/v1/catalogue/packs
```

In the desktop app, the **Downloads** module should list the seeded sample packs.

### 4. Stop

```bash
docker compose -f infra/docker-compose.yml down        # add -v to wipe volumes
```

## Run locally without Docker (hybrid)

This is the normal desktop development loop, with no cloud needed:

```bash
pnpm install      # Electron downloads its binary lazily on first launch
pnpm dev          # electron-vite: main + preload watch, renderer HMR on :5173
```

Available now (Phase 0):

```bash
pnpm check        # lint → format:check → typecheck → depcruise → unit tests (what CI's first job runs)
pnpm test         # vitest, single root config, tests in __tests__/*.test.ts(x)
pnpm test:e2e     # builds the app, then Playwright launches the real Electron build
pnpm depcruise    # architectural import rules (.dependency-cruiser.cjs)
pnpm dist:dir     # unsigned unpacked app in apps/desktop/release/ (no installer)
./docs/diagrams/render.sh                                    # regenerate docs diagrams
```

Planned (not built yet):

```bash
pnpm dev -- --workspace=./.dev-workspace         # Phase 1: isolated userData for testing
pnpm --filter @cmp/database db:generate          # Phase 1: drizzle-kit migration from schema
pnpm --filter @cmp/database db:studio            # Phase 1: inspect workspace.db
```

**Install scripts are deny-by-default.** pnpm only runs a dependency's install script if `pnpm-workspace.yaml` → `allowBuilds` lists it as `true`. When Phase 1 adds `better-sqlite3`, add it there; otherwise its native build silently won't run.

**Workspace packages ship TypeScript source.** Each `packages/*` exports `./src/index.ts` directly, with no build step. electron-vite bundles them into the app. That is why everything in `apps/desktop` is a devDependency: nothing is loaded from `node_modules` at runtime, so the packaged asar contains only `out/` and `package.json`.

**Testing with a projector:** connect it in **extended** (not mirrored) mode, open Settings → Displays → Identify, assign it as the audience display, and run the test pattern to check overscan against the safe-area guide.

## Port map (default)

| Port        | Service                                                       | When                                       |
| ----------- | ------------------------------------------------------------- | ------------------------------------------ |
| 5173        | Vite dev server (operator + audience renderers)               | Dev only                                   |
| 9229 / 9222 | Node inspector (main) / Chromium remote debugging (renderers) | Dev only. Disabled by fuses in production. |
| 4000        | Cloud API (NestJS)                                            | Optional, post-MVP                         |
| 5432        | PostgreSQL                                                    | Optional, post-MVP                         |
| 6379        | Redis                                                         | Optional, post-MVP                         |
| 9000 / 9001 | MinIO API / console (R2 stand-in)                             | Optional, post-MVP                         |

The production desktop app opens **no listening ports**. (The Phase 3 phone remote will add an opt-in LAN port with pairing.)

## Production deployment

### Recommended stack

| Concern          | Choice                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Installer build  | electron-builder in GitHub Actions (matrix: `windows-latest`, `macos-14`)                                          |
| Windows artifact | NSIS `.exe` (per-user install, no admin needed) + `.blockmap` for differential updates                             |
| macOS artifact   | Universal (arm64 + x64) `.dmg` + `.zip` (zip is needed by the updater)                                             |
| Windows signing  | Azure Trusted Signing (cheapest current path) or an EV certificate on a cloud HSM                                  |
| macOS signing    | Developer ID Application cert + `notarytool` + staple                                                              |
| Update feed      | GitHub Releases (`latest.yml`, `latest-mac.yml`), mirrored to Cloudflare R2 for bandwidth                          |
| Website          | Static site on Cloudflare Pages with download buttons that point at the latest release                             |
| Optional cloud   | DigitalOcean App Platform or a 2 vCPU droplet with Docker Compose. Managed Postgres, Upstash Redis, Cloudflare R2. |

Release flow:

```bash
pnpm version minor                     # bumps apps/desktop/package.json
git push --follow-tags                 # tag vX.Y.Z triggers .github/workflows/release.yml
# workflow: build → sign → notarise → publish draft release → smoke test → promote
```

### Desktop-specific production notes

- **Never update during a service.** `autoInstallOnAppQuit: true`, `autoDownload: true`, and the "Restart to update" prompt is suppressed while `live_sessions` has an open session.
- **Channels:** `updates.channel` setting maps to `alpha` / `beta` / `latest` feeds. Pilot churches use `beta`.
- **Staged rollout:** set `stagingPercentage: 10` in `latest.yml` and raise it to 50 and then 100 over a week if crash reports stay flat.
- **Native modules:** `better-sqlite3` is rebuilt per platform/arch by electron-builder (`npmRebuild: true`). Universal macOS builds merge both arches with `@electron/universal`.
- **ffmpeg:** ship platform-specific LGPL static builds in `extraResources`. Exclude the other platforms' binaries with `files` filters.
- **Bundled content:** public-domain Bibles, built-in templates and the sample pack go in `extraResources/content/` and are copied into the workspace on first run.
- **Install size budget:** < 250 MB installed (Electron ~180 MB + ffmpeg + content).
- **Offline install:** the installer must be fully self-contained. Many churches download it once elsewhere and carry it in on a USB drive.

### Environment variables (production)

Desktop build (CI secrets):

| Variable                                                               | Purpose                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`             | notarytool                                                                |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                                         | macOS Developer ID cert (base64 p12)                                      |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`            | Azure Trusted Signing                                                     |
| `GH_TOKEN`                                                             | Publish to GitHub Releases                                                |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` | Mirror the update feed                                                    |
| `CMP_PACK_PUBKEY`                                                      | Ed25519 public key compiled into the app for pack verification (post-MVP) |
| `SENTRY_DSN` (optional)                                                | Opt-in crash reports                                                      |

Optional cloud API:

| Variable                           | Purpose                                       |
| ---------------------------------- | --------------------------------------------- |
| `DATABASE_URL`                     | PostgreSQL                                    |
| `REDIS_URL`                        | BullMQ                                        |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Auth                                          |
| `R2_*`                             | Pack storage + signed URLs                    |
| `PACK_SIGNING_KEY`                 | Ed25519 private key (KMS/secret manager only) |

## Cost estimate (small production)

| Item                                                                                               | Monthly (USD) |
| -------------------------------------------------------------------------------------------------- | ------------- |
| Apple Developer Program                                                                            | ~$8 ($99/yr)  |
| Azure Trusted Signing (Basic)                                                                      | ~$10          |
| GitHub (public repo, Actions minutes on macOS runners)                                             | $0–$20        |
| Cloudflare R2 update mirror (≈ 2,000 churches × 150 MB/month egress is free on R2; storage ~20 GB) | ~$0.30        |
| Cloudflare Pages website                                                                           | $0            |
| **MVP total**                                                                                      | **≈ $20–40**  |
| Optional cloud (post-MVP): droplet $24 + managed Postgres $15 + Upstash $0–10 + R2 packs storage   | +$40–60       |

The product is free, so costs stay deliberately flat. R2's zero egress fees are why it is the media and update CDN.

## Troubleshooting

| Symptom                                                                               | Cause / fix                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Error: The module was compiled against a different Node.js version` (better-sqlite3) | Check `better-sqlite3` is `true` under `allowBuilds` in `pnpm-workspace.yaml`, then run `pnpm --filter @cmp/desktop exec electron-builder install-app-deps`. |
| Audience window opens on the laptop screen                                            | The display is mirrored. Switch the OS to **extended** mode, then reassign in Settings → Displays.                                                           |
| Black bars or cropped text on the projector                                           | The projector applies overscan. Turn on "Just scan/1:1" on the projector or raise `display.safeAreaPct`.                                                     |
| Video plays with no picture (audio only)                                              | Unsupported codec (for example HEVC without hardware decode, or ProRes). Use Media → Transcode to H.264.                                                     |
| macOS: "App is damaged and can't be opened"                                           | Not notarised/stapled. Check the notarytool log in the release job.                                                                                          |
| Windows SmartScreen warning                                                           | A new certificate has no reputation yet. It clears with downloads, or use an EV cert.                                                                        |
| macOS: app cannot see a second display in fullscreen                                  | System Settings → Desktop & Dock → disable "Displays have separate Spaces" (or rely on `simpleFullscreen`).                                                  |
| Workspace upgrade failed on launch                                                    | A pre-migration backup is in `<userData>/backups/`. See [RUNBOOK.md](RUNBOOK.md#sqlite-migrations-in-production).                                            |
| Diagrams missing PNGs                                                                 | `brew install graphviz && ./docs/diagrams/render.sh`                                                                                                         |
