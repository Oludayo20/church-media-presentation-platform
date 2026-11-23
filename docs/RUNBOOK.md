# Runbook — Church Media & Worship Presentation Platform

This runbook covers operational procedures for releasing the desktop app, rolling it back and supporting churches. The product runs on church computers, not our servers, so "production incidents" usually mean **a bad release reaching operators before Sunday**. Every procedure here aims to stop that or undo it fast.

**Release freeze:** do not promote a release to `stable` between **Friday 18:00 and Monday 06:00 (WAT)**. Most churches run their main services in that window, and Wednesday/Friday services are the secondary risk.

## Deploy

### Alpha (internal)

1. Merge to `main` → CI builds unsigned artifacts per platform.
2. Tag `vX.Y.Z-alpha.N` → release workflow signs and publishes the `alpha` channel.
3. Internal testers run the hardware checklist (projector, LED, 2 videos, Quick Scripture, unplug/replug).

### Beta (pilot churches)

1. Tag `vX.Y.Z-beta.N` on a commit that passed alpha for ≥ 3 days.
2. Draft release → smoke test on a clean Windows 11 VM + macOS (arm64 and x64): install, onboard, run the sample service, restore a backup.
3. Publish. Pilot churches on the `beta` channel receive it on next launch and install it on quit.
4. Collect the per-service feedback forms after the weekend.

### Stable

1. Tag `vX.Y.Z` from the beta commit that ran **at least one full weekend** of pilot services without a live-module crash.
2. Publish with `stagingPercentage: 10` in `latest.yml` / `latest-mac.yml`, on Monday or Tuesday.
3. Raise to 50% on Wednesday and 100% on Thursday if the crash-free sessions rate is ≥ 99.5% and there are no new `live`/`engine` issues.
4. Update the website download links and release notes.

## Rollback

electron-updater does not downgrade automatically. Rollback means **publishing a higher version that contains the old code**.

1. **Stop the spread:** edit `latest.yml` / `latest-mac.yml` on R2 and GitHub. Set `stagingPercentage: 0`, or re-point the files to the previous version's artifacts. Clients that have not downloaded yet stop receiving the update.
2. **Ship the revert:** `git revert` the offending commits (or check out the last good tag), then bump to `vX.Y.(Z+1)`, tag, and fast-track through the release workflow. Alpha/beta soak is skipped for pure reverts, but the smoke test is required.
3. **Database compatibility:** if the bad release ran a migration, the revert release must still understand the _new_ schema. Migrations are expand-only (see below), so the old code ignores new columns and tables. Never ship a revert that drops data.
4. **Affected operators:** post on the support channel and website banner: "If version X.Y.Z misbehaves, download X.Y.Z+1 from <link>". Offline churches can install it from a USB drive. The installer upgrades in place and keeps the workspace.
5. Write a post-incident note within 48 h (timeline, blast radius, root cause, prevention).

## SQLite migrations in production

The "production database" is thousands of independent `workspace.db` files on church laptops. Migration rules:

1. **Expand-only within a major version.** Add tables and columns (nullable or with a default) and add indexes. Never drop or rename in a minor release. Data backfills run in code and are idempotent.
2. **Contract** (drop or rename) only in a major version, at least two minors after the expand, once telemetry or the beta shows nobody is still on the old version.
3. Every migration runs **after an automatic pre-migration backup** ([DOCUMENTATION.md §9.2](DOCUMENTATION.md#92-migrations)), inside a transaction. On failure the app rolls back, keeps the old schema and shows a recovery dialog.
4. Test every migration against a **corpus of real anonymised workspaces** (with consent from pilot churches) plus a 100k-verse/2k-song/5k-asset synthetic workspace. CI job: `pnpm --filter database test:migrations`.
5. SQLite `ALTER TABLE` limits: for table rebuilds, use the 12-step procedure (create new, copy, drop, rename) with `PRAGMA foreign_keys=OFF` inside the transaction, then `PRAGMA foreign_key_check` before commit.
6. **Supporting a failed upgrade:** ask the operator for _Help → Save support bundle_ (logs + schema version, no content). To recover manually: quit the app, copy the latest `<userData>/backups/pre-migrate-*.cmpbackup`, install the previous app version, then use File → Restore backup.

## Observability

There are no servers to watch for the MVP. Signals are:

| Signal                        | Source                                     | Threshold / action                             |
| ----------------------------- | ------------------------------------------ | ---------------------------------------------- |
| Crash-free sessions           | Sentry (opt-in)                            | < 99.5% on a new release → halt staged rollout |
| `live`/`engine` module errors | Sentry issue alerts                        | Any new issue → triage before the weekend      |
| Slide switch p95              | Opt-in anonymous perf event                | > 150 ms → investigate                         |
| Display reconnect failures    | Sentry breadcrumb `display.restore.failed` | Investigate hardware combination               |
| Update adoption               | R2 access logs per version                 | Sanity check rollout progress                  |
| Support bundle reports        | Support inbox / GitHub issues              | Weekly review                                  |

Local logs on a church machine: `<userData>/logs/main.log` (macOS `~/Library/Application Support/Church Media/logs/`, Windows `%APPDATA%\Church Media\logs\`).

## Common incidents

| Incident                                                | Likely cause                                                                                        | Response                                                                                                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Projector shows my desktop / controls"                 | OS in mirror mode, or the audience display was reassigned to the primary display                    | Guide: OS display settings → Extend. App: Settings → Displays → Identify → assign.                                                                                                         |
| "Projector went black mid-service and didn't come back" | Display reconnected with a different fingerprint (new adapter, resolution changed)                  | Operator: click the banner "Use this display". Engineering: widen fingerprint matching (label + size, ignore scale).                                                                       |
| "Video stutters"                                        | Software decode (HEVC/4K on an old GPU), or a power-saver plan                                      | Transcode to 1080p H.264 in Media. Set Windows power plan to High Performance and plug in the charger.                                                                                     |
| "Lyrics overflow the screen"                            | Long lines, font-fit floor reached                                                                  | Lower lines per slide or raise `maxChars`. Check the template text box.                                                                                                                    |
| "App won't open after update"                           | Migration failure or a corrupt asar                                                                 | Recovery dialog → restore pre-migration backup. Reinstall the previous version from the website.                                                                                           |
| "All my media shows missing"                            | Workspace copied without the `media/` folder, or the drive letter changed for an external workspace | Media → Scan missing → Relocate folder. Restore from `.cmpbackup` (includes media).                                                                                                        |
| "Bible verse not found"                                 | Book alias missing for the locale, or versification difference                                      | Add the alias (hotfix the alias seed). Report the translation versification.                                                                                                               |
| Bad release reached stable                              | —                                                                                                   | Follow [Rollback](#rollback).                                                                                                                                                              |
| Signing certificate expired / revoked                   | —                                                                                                   | Renew ([EXTERNAL_INTEGRATIONS.md §1–2](EXTERNAL_INTEGRATIONS.md#1-apple-developer-id-signing--notarisation)) and re-release. Already-installed apps keep running (timestamped signatures). |
