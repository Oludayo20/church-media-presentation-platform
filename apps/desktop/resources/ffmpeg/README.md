# Bundled ffmpeg / ffprobe

The media import pipeline (docs/DOCUMENTATION.md §7) uses `ffprobe` for
duration, dimensions and codecs, and `ffmpeg` for thumbnails, posters and
conversion to H.264 MP4. The app looks for them in this order:

1. `resources/ffmpeg/<os>-<arch>/` — bundled into packaged builds by
   `electron-builder.yml` → `extraResources` (`<os>` is `mac`, `win` or
   `linux`; `<arch>` is `x64` or `arm64`). The binaries are named `ffmpeg` and
   `ffprobe` (`.exe` on Windows).
2. `CMP_FFMPEG_PATH` / `CMP_FFPROBE_PATH`.
3. `PATH` (development only; for example Homebrew's ffmpeg).

Without them imports still work, but there is no probing, no posters and no
conversion.

**Licence (docs/TASKS.md Phase 4):** ship **LGPL** builds only, and keep the
licence text and the matching source offer with the release. The binaries
are not committed to git (see `.gitignore`). Choosing the binary source is
an open decision; see the Phase 4 notes in docs/TASKS.md.
