# External Integrations — Step by Step

The MVP desktop app has **no runtime dependency on any third-party service**. The external integrations below are needed to _ship_ it (signing, update hosting) and to _legally bundle content_ (Bible translations, song licensing, fonts and media). The optional cloud catalogue (post-MVP) adds Cloudflare R2.

## Table of contents

1. [Apple Developer ID signing & notarisation](#1-apple-developer-id-signing--notarisation)
2. [Windows code signing](#2-windows-code-signing)
3. [GitHub Releases + Cloudflare R2 update feed](#3-github-releases--cloudflare-r2-update-feed)
4. [Bible translation licensing & packages](#4-bible-translation-licensing--packages)
5. [Song, font & media licensing (CCLI and friends)](#5-song-font--media-licensing-ccli-and-friends)
6. [Optional: crash reporting (Sentry)](#6-optional-crash-reporting-sentry)

---

## 1. Apple Developer ID signing & notarisation

Unsigned or un-notarised apps are blocked by Gatekeeper on modern macOS.

1. Enrol in the **Apple Developer Program** (developer.apple.com/programs, US$99/yr). Use an organisation account if you have a legal entity (needs a D-U-N-S number), because the "Developer" name appears in the security dialogs.
2. In **Certificates, Identifiers & Profiles → Certificates**, create a **Developer ID Application** certificate. Generate the CSR from Keychain Access → Certificate Assistant → Request a Certificate.
3. Install the downloaded `.cer`, then export it _with its private key_ from Keychain as `developer-id.p12` with a strong password.
4. Base64 it for CI: `base64 -i developer-id.p12 | pbcopy`, and store the result as the `CSC_LINK` secret. Store the password as `CSC_KEY_PASSWORD`.
5. At appleid.apple.com → Sign-In and Security → **App-Specific Passwords**, create one for "notarytool". Store it as `APPLE_APP_SPECIFIC_PASSWORD`, with `APPLE_ID` and `APPLE_TEAM_ID` (Membership page).
   - Preferred alternative: an **App Store Connect API key** (Users and Access → Keys) → `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
6. In `electron-builder.yml`:
   ```yaml
   mac:
     target:
       [{ target: dmg, arch: universal }, { target: zip, arch: universal }]
     hardenedRuntime: true
     gatekeeperAssess: false
     entitlements: build/entitlements.mac.plist
     entitlementsInherit: build/entitlements.mac.plist
     notarize: true
   ```
   Entitlements: `com.apple.security.cs.allow-jit` (V8) and `com.apple.security.cs.allow-unsigned-executable-memory` _only if_ needed. Do **not** add `disable-library-validation` unless the bundled ffmpeg requires it. Sign ffmpeg as well.
7. Verify a build locally:
   ```bash
   codesign --verify --deep --strict --verbose=2 "dist/mac-universal/Church Media.app"
   spctl --assess --type execute --verbose "dist/mac-universal/Church Media.app"
   xcrun stapler validate "dist/Church Media-1.0.0-universal.dmg"
   ```
8. Renew the certificate before it expires (5 years). Apps signed before expiry with a secure timestamp keep running.

## 2. Windows code signing

Unsigned installers trigger SmartScreen "Windows protected your PC" warnings, which scare volunteers.

**Option A: Azure Trusted Signing (recommended, ~US$10/month)**

1. Create an Azure subscription, then in the portal create a **Trusted Signing Account** (resource provider `Microsoft.CodeSigning`) in a supported region.
2. Complete **Identity validation** (organisation or individual, where currently supported). Approval takes 1–7 business days.
3. Create a **Certificate Profile** of type _Public Trust_.
4. Create an **App registration** (Entra ID) for CI. Grant it the role **Trusted Signing Certificate Profile Signer** on the account. Store `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`.
5. electron-builder (v25+):
   ```yaml
   win:
     target: [{ target: nsis, arch: [x64, arm64] }]
     azureSignOptions:
       publisherName: "Your Org Name"
       endpoint: https://<region>.codesigning.azure.net
       codeSigningAccountName: <account>
       certificateProfileName: <profile>
   nsis:
     oneClick: false
     perMachine: false
     allowToChangeInstallationDirectory: true
   ```
6. Verify: `signtool verify /pa /v "Church Media Setup 1.0.0.exe"`.

**Option B: an EV/OV certificate** from a CA (DigiCert, Sectigo, SSL.com). Since 2023 the private key must live on an HSM or token, so use the CA's cloud signing service (for example SSL.com eSigner) with electron-builder's custom `sign` hook.

SmartScreen reputation builds with download volume. Expect warnings for the first few hundred installs on a new certificate, and mention this in the installation guide.

## 3. GitHub Releases + Cloudflare R2 update feed

**GitHub Releases (primary)**

1. Create a fine-grained PAT, or use the workflow's `GITHUB_TOKEN` with `contents: write`, and store it as `GH_TOKEN`.
2. `electron-builder.yml`:
   ```yaml
   publish:
     - provider: github
       owner: <org>
       repo: church-media-presentation-platform
       releaseType: draft
   ```
3. The release job uploads the installers, `.blockmap` files and `latest.yml`/`latest-mac.yml`. Promote the draft to published after the smoke test.
4. Channels: tag `v1.2.0-beta.1` publishes `beta.yml`. electron-updater with `allowPrerelease` / `channel = 'beta'` follows it.

**Cloudflare R2 mirror (bandwidth and resilience)**

1. Cloudflare dashboard → R2 → **Create bucket** `cmp-releases`.
2. Bucket → Settings → **Custom domain** `updates.<your-domain>` (public read).
3. R2 → **Manage API tokens** → create an _Object Read & Write_ token scoped to the bucket. Store `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_ENDPOINT` (`https://<accountid>.r2.cloudflarestorage.com`).
4. Add a second publish provider:
   ```yaml
   - provider: generic
     url: https://updates.<your-domain>/${channel}
   ```
   and a CI step that runs `aws s3 sync dist/ s3://cmp-releases/latest/ --endpoint-url $R2_ENDPOINT --exclude "*" --include "*.yml" --include "*.exe" --include "*.dmg" --include "*.zip" --include "*.blockmap"`.
5. The app reads the generic feed first and falls back to GitHub. Update checks are skipped entirely when offline.

## 4. Bible translation licensing & packages

**Do not assume a translation can be bundled.** Each one needs its own review.

| Translation                                                                   | Status (verify before shipping)                                                          | Action                                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| KJV (Authorized Version)                                                      | Public domain worldwide except UK Crown patent                                           | Bundle                                                                                         |
| WEB (World English Bible)                                                     | Public domain                                                                            | Bundle                                                                                         |
| ASV (1901), Darby, YLT                                                        | Public domain                                                                            | Bundle                                                                                         |
| Bibeli Mimọ (Yoruba, 1900 Crowther-based) and other older vernacular editions | Check edition and publisher (Bible Society of Nigeria)                                   | Bundle only with written confirmation                                                          |
| NIV, NKJV, ESV, NLT, AMP, MSG                                                 | Copyrighted (Biblica, HarperCollins/Thomas Nelson, Crossway, Tyndale, Lockman, NavPress) | **Never bundle.** The church imports its own licensed file, or you pursue a publisher licence. |

Steps for any translation you intend to **bundle**:

1. Identify the exact edition and its source text (for example eBible.org, CrossWire SWORD module, or Digital Bible Library).
2. Record the licence text, source URL and date retrieved in `assets/bibles/<code>/LICENCE.md`.
3. Convert with the CLI: `pnpm --filter import-export bible:convert --format usfm --in ./src/web --out ./assets/bibles/web.cmpbible --code WEB --licence "Public Domain"`.
4. Verify the verse count against the versification (`bible:verify`). KJV has 31,102 verses.
5. Add it to `extraResources/content/bibles/`.

Steps for **church-imported** translations: Bible → Translations → Import accepts `.cmpbible`, OSIS XML, USFM zip or Zefania XML. On import the app shows a notice that the church is responsible for holding a licence to project that translation publicly. Some publishers allow limited projection (for example up to N verses per service) under their own terms, and the app records `licence` and `attribution` and shows the attribution footer.

For a publisher licence (to bundle NIV and similar), apply through the publisher's permissions office (for example Biblica permissions for NIV, or HarperCollins Christian Publishing for NKJV). Expect fees and usage reporting, so plan this as a Phase 4 business decision.

## 5. Song, font & media licensing (CCLI and friends)

**Songs**

- The app ships **no copyrighted lyrics**. Public-domain hymns (for example _Amazing Grace_, _Great Is Thy Faithfulness_ is **not** PD, so verify each one) may be bundled after a per-song check.
- Churches projecting copyrighted songs need their own licence. In many countries that is a **CCLI Church Copyright Licence** (ccli.com). Coverage in Nigeria and many African countries is limited, so churches should check the licensing body in their own country.
- Store `ccli_number` and `licence_reference` on songs. The optional copyright footer ([DOCUMENTATION.md §5.2](DOCUMENTATION.md#52-algorithm)) satisfies typical display requirements.
- **SongSelect import** (file-based, MVP): churches with a SongSelect subscription download `.txt`/`.usr` files and import them. No API account is needed.
- **SongSelect API** (Phase 4, optional): CCLI's partner integration needs a partner agreement. Contact CCLI partner relations, sign the agreement, receive OAuth client credentials, and implement the OAuth 2.0 flow. Treat this as a business-development task, not an engineering one.

**Fonts**

- Bundle only SIL OFL / Apache-licensed fonts (for example Inter, Montserrat, Noto Sans with full Latin Extended-A/B for Yoruba/Igbo diacritics, and Noto Sans Ethiopic where needed).
- Record each font's licence in `assets/fonts/LICENCES.md`. User-imported fonts get an acknowledgement dialog.

**Media & templates**

- Commission or license motion backgrounds and templates with **explicit redistribution rights inside free software**. Typical stock licences (Shift Worship, Pixabay or Pexels terms) may forbid redistribution as part of a library. Get it in writing.
- Store licence metadata in `media_licences` (`licence_type`, `source`, `attribution`, `terms`), and keep source contracts outside the repo.

## 6. Optional: crash reporting (Sentry)

1. Create a Sentry org → project → platform **Electron**. Copy the DSN into the `SENTRY_DSN` CI secret.
2. Initialise `@sentry/electron` in main and renderers **only if** `settings.telemetry.crashReports === true` (off by default, asked during onboarding).
3. Add a `beforeSend` scrubber that removes file paths, lyrics/slide text, church name and user names. See [SECURITY.md](SECURITY.md#privacy--telemetry).
4. Upload source maps in the release job (`sentry-cli sourcemaps upload`) with the release name `cmp@<version>`.
5. Configure an alert for "new issue in the `live` module" so it pages the on-call developer before the next Sunday.
