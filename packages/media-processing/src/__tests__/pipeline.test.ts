import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ImportError,
  makeThumbnail,
  parseProbe,
  playbackAdvice,
  probe,
  resolveFfTools,
  sniffMedia,
  storeFile,
  transcodeToMp4,
} from "../index";

const CLIP = resolve(
  __dirname,
  "../../../../apps/desktop/tests/e2e/fixtures/clip.mp4",
);
const tools = resolveFfTools({});
const hasFfmpeg = Boolean(tools.ffmpeg && tools.ffprobe);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmp-media-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(
    parts.map((part) =>
      typeof part === "string"
        ? Buffer.from(part, "latin1")
        : Buffer.from(part),
    ),
  );

describe("sniffMedia", () => {
  it.each([
    [
      "png",
      bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "image/png",
    ],
    ["jpg", bytes([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    ["gif", bytes("GIF89a"), "image/gif"],
    ["webp", bytes("RIFF\0\0\0\0WEBPVP8 "), "image/webp"],
    ["mp4", bytes([0, 0, 0, 0x18], "ftypisom"), "video/mp4"],
    ["mov", bytes([0, 0, 0, 0x14], "ftypqt  "), "video/quicktime"],
    ["m4a", bytes([0, 0, 0, 0x20], "ftypM4A "), "audio/mp4"],
    ["webm", bytes([0x1a, 0x45, 0xdf, 0xa3], "....webm"), "video/webm"],
    ["mp3 (id3)", bytes("ID3\x04"), "audio/mpeg"],
    ["mp3 (frame)", bytes([0xff, 0xfb, 0x90]), "audio/mpeg"],
    ["wav", bytes("RIFF\0\0\0\0WAVEfmt "), "audio/wav"],
    ["pdf", bytes("%PDF-1.7"), "application/pdf"],
    ["ttf", bytes([0, 1, 0, 0]), "font/ttf"],
    ["otf", bytes("OTTO"), "font/otf"],
  ])("%s", (_name, input, mime) => {
    expect(sniffMedia(input)?.mime).toBe(mime);
  });

  it("needs the .pptx name for a zip, and rejects SVG and other Matroska", () => {
    expect(sniffMedia(bytes([0x50, 0x4b, 0x03, 0x04]), "deck.pptx")?.ext).toBe(
      "pptx",
    );
    expect(
      sniffMedia(bytes([0x50, 0x4b, 0x03, 0x04]), "archive.zip"),
    ).toBeNull();
    expect(sniffMedia(bytes("<svg xmlns=")), "logo.svg").toBeNull();
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3], "matroska"))).toBeNull();
  });
});

describe("storeFile", () => {
  const png = bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "rest-of-file",
  );
  const media = () => join(dir, "media");

  it("stores content-addressed and reports a duplicate without copying", async () => {
    writeFileSync(join(dir, "a.png"), png);
    writeFileSync(join(dir, "copy of a.png"), png);
    const first = await storeFile(join(dir, "a.png"), media());
    expect(first).toMatchObject({ alreadyStored: false, size: png.byteLength });
    expect(first.relativePath).toBe(
      `${first.checksum.slice(0, 2)}/${first.checksum}.png`,
    );
    const second = await storeFile(join(dir, "copy of a.png"), media());
    expect(second).toMatchObject({
      alreadyStored: true,
      checksum: first.checksum,
    });
    expect(readdirSync(media()).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("an interrupted (cancelled) copy leaves no partial file anywhere", async () => {
    const big = Buffer.concat([
      bytes([0, 0, 0, 0x18], "ftypisom"),
      Buffer.alloc(24 * 1024 * 1024, 1),
    ]);
    writeFileSync(join(dir, "big.mp4"), big);
    const controller = new AbortController();
    const result = storeFile(join(dir, "big.mp4"), media(), {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(result).rejects.toMatchObject({ code: "CANCELLED" });
    const leftovers = existsSync(media())
      ? readdirSync(media(), { recursive: true })
      : [];
    expect(leftovers.filter((f) => String(f).includes("."))).toEqual([]);
  });

  it("rejects unsupported content and filtered types", async () => {
    writeFileSync(join(dir, "evil.png"), "#!/bin/sh\necho pwned");
    await expect(
      storeFile(join(dir, "evil.png"), media()),
    ).rejects.toBeInstanceOf(ImportError);
    writeFileSync(join(dir, "a.png"), png);
    await expect(
      storeFile(join(dir, "a.png"), media(), { accept: ["video"] }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
    await expect(
      storeFile(join(dir, "missing.png"), media()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("parseProbe / playbackAdvice", () => {
  const h264 = parseProbe({
    format: { duration: "12.5" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
      { codec_type: "audio", codec_name: "aac" },
    ],
  });

  it("extracts duration, size, codecs and audio", () => {
    expect(h264).toEqual({
      durationMs: 12_500,
      width: 1920,
      height: 1080,
      videoCodec: "h264",
      audioCodec: "aac",
      hasVideo: true,
      hasAudio: true,
    });
  });

  it("ignores audio cover art as video", () => {
    const mp3 = parseProbe({
      format: { duration: "200" },
      streams: [
        { codec_type: "audio", codec_name: "mp3" },
        {
          codec_type: "video",
          codec_name: "mjpeg",
          width: 500,
          height: 500,
          disposition: { attached_pic: 1 },
        },
      ],
    });
    expect(mp3).toMatchObject({ hasVideo: false, width: null, hasAudio: true });
  });

  it("offers transcoding for unplayable codecs and large GIFs, warns for HEVC", () => {
    const advise = (videoCodec: string, audioCodec = "aac") =>
      playbackAdvice({
        mime: "video/mp4",
        size: 1,
        probe: { ...h264, videoCodec, audioCodec },
      });
    expect(advise("h264")).toEqual({
      transcodeReason: null,
      playbackWarning: null,
    });
    expect(advise("prores")).toEqual({
      transcodeReason: "unsupported-codec",
      playbackWarning: null,
    });
    expect(advise("h264", "ac3")).toMatchObject({
      transcodeReason: "unsupported-codec",
    });
    expect(advise("hevc")).toEqual({
      transcodeReason: null,
      playbackWarning: "hevc",
    });
    expect(
      playbackAdvice({ mime: "image/gif", size: 6 * 1024 * 1024, probe: null })
        .transcodeReason,
    ).toBe("large-gif");
    expect(
      playbackAdvice({ mime: "image/gif", size: 1024, probe: null })
        .transcodeReason,
    ).toBeNull();
  });
});

describe("resolveFfTools", () => {
  it("prefers the bundled binaries, then env, then PATH", () => {
    writeFileSync(join(dir, "ffmpeg"), "");
    writeFileSync(join(dir, "ffprobe"), "");
    expect(
      resolveFfTools({
        bundledDir: dir,
        env: { PATH: "" },
        platform: "darwin",
      }),
    ).toEqual({
      ffmpeg: join(dir, "ffmpeg"),
      ffprobe: join(dir, "ffprobe"),
    });
    expect(
      resolveFfTools({
        env: { PATH: "", CMP_FFPROBE_PATH: join(dir, "ffprobe") },
      }),
    ).toEqual({
      ffmpeg: null,
      ffprobe: join(dir, "ffprobe"),
    });
  });
});

describe.skipIf(!hasFfmpeg)("with ffmpeg installed", () => {
  it("probes, makes a poster and transcodes", async () => {
    const result = await probe(tools.ffprobe!, CLIP);
    expect(result).toMatchObject({
      width: 640,
      height: 360,
      videoCodec: "h264",
      hasAudio: true,
    });
    expect(result.durationMs).toBeGreaterThan(5000);

    const poster = await makeThumbnail({
      ffmpeg: tools.ffmpeg!,
      source: CLIP,
      targetBase: join(dir, "thumbs", "clip"),
      isVideo: true,
      durationMs: result.durationMs,
    });
    expect(existsSync(poster)).toBe(true);

    const fractions: number[] = [];
    await transcodeToMp4({
      ffmpeg: tools.ffmpeg!,
      source: CLIP,
      target: join(dir, "out.mp4"),
      durationMs: result.durationMs,
      onProgress: (f) => fractions.push(f),
    });
    expect((await probe(tools.ffprobe!, join(dir, "out.mp4"))).videoCodec).toBe(
      "h264",
    );
    expect(existsSync(join(dir, "out.mp4.tmp.mp4"))).toBe(false);
  }, 30_000);

  it("cancelling a transcode kills ffmpeg and leaves no output", async () => {
    const controller = new AbortController();
    const job = transcodeToMp4({
      ffmpeg: tools.ffmpeg!,
      source: CLIP,
      target: join(dir, "cancel.mp4"),
      durationMs: 6000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(job).rejects.toThrow(/cancelled/);
    expect(readdirSync(dir)).toEqual([]);
  });
});
