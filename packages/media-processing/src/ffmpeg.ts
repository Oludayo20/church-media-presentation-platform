import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

export interface FfTools {
  ffmpeg: string | null;
  ffprobe: string | null;
}

/**
 * Finds ffmpeg/ffprobe: the bundled binaries first (packaged app,
 * `resources/ffmpeg/<platform>-<arch>/`), then explicit env overrides, then
 * `PATH` (development). Missing tools are not fatal: imports still work,
 * without duration, dimensions, posters or transcoding.
 */
export function resolveFfTools(options: {
  bundledDir?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): FfTools {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exe = (name: string) => (platform === "win32" ? `${name}.exe` : name);
  const find = (
    name: "ffmpeg" | "ffprobe",
    override: string | undefined,
  ): string | null => {
    if (options.bundledDir) {
      const bundled = join(options.bundledDir, exe(name));
      if (existsSync(bundled)) return bundled;
    }
    if (override && existsSync(override)) return override;
    for (const dir of (env["PATH"] ?? "").split(delimiter)) {
      if (!dir) continue;
      const candidate = join(dir, exe(name));
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };
  return {
    ffmpeg: find("ffmpeg", env["CMP_FFMPEG_PATH"]),
    ffprobe: find("ffprobe", env["CMP_FFPROBE_PATH"]),
  };
}

export interface ProbeResult {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

interface FfprobeJson {
  format?: { duration?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
    disposition?: { attached_pic?: number };
  }[];
}

/** Pure: ffprobe `-show_format -show_streams -of json` output → ProbeResult. */
export function parseProbe(json: FfprobeJson): ProbeResult {
  const streams = json.streams ?? [];
  // Cover art in audio files is a "video" stream with attached_pic.
  const video = streams.find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  const audio = streams.find((s) => s.codec_type === "audio");
  const seconds = Number(
    json.format?.duration ?? video?.duration ?? audio?.duration,
  );
  return {
    durationMs:
      Number.isFinite(seconds) && seconds > 0
        ? Math.round(seconds * 1000)
        : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

const PLAYABLE_VIDEO = new Set(["h264", "vp8", "vp9", "av1"]);
const PLAYABLE_AUDIO = new Set([
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "alac",
]);
export const LARGE_GIF_BYTES = 5 * 1024 * 1024;

export type TranscodeReason = "unsupported-codec" | "large-gif";
export type PlaybackWarning = "hevc";

/**
 * DOCUMENTATION.md §7 step 5 + GIF strategy: what should be offered for
 * conversion to H.264 MP4, and what only plays with hardware support.
 */
export function playbackAdvice(input: {
  mime: string;
  size: number;
  probe: ProbeResult | null;
}): {
  transcodeReason: TranscodeReason | null;
  playbackWarning: PlaybackWarning | null;
} {
  if (input.mime === "image/gif") {
    return {
      transcodeReason: input.size > LARGE_GIF_BYTES ? "large-gif" : null,
      playbackWarning: null,
    };
  }
  const probe = input.probe;
  if (!probe || !input.mime.startsWith("video/"))
    return { transcodeReason: null, playbackWarning: null };
  if (probe.videoCodec === "hevc")
    return { transcodeReason: null, playbackWarning: "hevc" };
  const badVideo =
    probe.videoCodec !== null && !PLAYABLE_VIDEO.has(probe.videoCodec);
  const badAudio =
    probe.audioCodec !== null &&
    !PLAYABLE_AUDIO.has(probe.audioCodec) &&
    !probe.audioCodec.startsWith("pcm_");
  return {
    transcodeReason: badVideo || badAudio ? "unsupported-codec" : null,
    playbackWarning: null,
  };
}

interface RunOptions {
  signal?: AbortSignal | undefined;
  onStdout?: (text: string) => void;
}

/** Runs a tool with arguments (never a shell). Rejects on non-zero exit. */
export function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("cancelled"));
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const abort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) reject(new Error("cancelled"));
      else if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            `${command} exited with ${code}: ${stderr.trim().split("\n").pop()}`,
          ),
        );
    });
  });
}

export async function probe(
  ffprobe: string,
  path: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const out = await run(
    ffprobe,
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
    { signal },
  );
  return parseProbe(JSON.parse(out) as FfprobeJson);
}

/**
 * DOCUMENTATION.md §7 step 6: a 320 px wide thumbnail (images) or poster
 * frame at 10% of the duration (videos). WebP where the ffmpeg build has
 * libwebp, otherwise JPEG. Returns the file written.
 */
export async function makeThumbnail(input: {
  ffmpeg: string;
  source: string;
  /** Path without extension; `.webp` or `.jpg` is appended. */
  targetBase: string;
  isVideo: boolean;
  durationMs: number | null;
  signal?: AbortSignal;
}): Promise<string> {
  await mkdir(dirname(input.targetBase), { recursive: true });
  const seek =
    input.isVideo && input.durationMs
      ? ["-ss", ((input.durationMs * 0.1) / 1000).toFixed(2)]
      : [];
  const common = [
    "-v",
    "error",
    "-y",
    ...seek,
    "-i",
    input.source,
    "-frames:v",
    "1",
    "-vf",
    "scale=320:-2",
  ];
  for (const [ext, codec] of [
    ["webp", ["-c:v", "libwebp", "-quality", "80"]],
    ["jpg", ["-q:v", "4"]],
  ] as const) {
    const target = `${input.targetBase}.${ext}`;
    try {
      await run(input.ffmpeg, [...common, ...codec, target], {
        signal: input.signal,
      });
      if (existsSync(target)) return target;
    } catch (error) {
      await rm(target, { force: true });
      if (input.signal?.aborted) throw error;
    }
  }
  throw new Error("Could not create a thumbnail");
}

/**
 * Converts to H.264/AAC MP4 (`+faststart`, yuv420p) for smooth playback,
 * reporting progress from `-progress`. Writes to a temp file, then renames.
 */
export async function transcodeToMp4(input: {
  ffmpeg: string;
  source: string;
  target: string;
  durationMs: number | null;
  loop?: boolean;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  const temp = `${input.target}.tmp.mp4`;
  const args = [
    "-v",
    "error",
    "-y",
    "-i",
    input.source,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    temp,
  ];
  try {
    await run(input.ffmpeg, args, {
      signal: input.signal,
      onStdout: (text) => {
        const match = /out_time_ms=(\d+)/.exec(text);
        if (match && input.durationMs) {
          input.onProgress?.(
            Math.min(1, Number(match[1]) / 1000 / input.durationMs),
          );
        }
      },
    });
    await rename(temp, input.target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
