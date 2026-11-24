import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMediaRepository,
  createWorkspaceRepository,
  migrate,
  migrations,
  newId,
  openDatabase,
  type Database,
} from "@cmp/database";
import {
  importImageFile,
  importMediaFile,
  sniffImage,
  sniffMedia,
} from "../media-import";

export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string;
let database: Database;
let churchId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cmp-import-"));
  database = openDatabase({ path: ":memory:" });
  await migrate(database.sqlite, migrations);
  churchId = newId();
  await createWorkspaceRepository(database).createWithOwner({
    churchId,
    churchName: "Grace",
    ownerDisplayName: "Owner",
  });
});
afterEach(() => {
  database.close();
  rmSync(dir, { recursive: true, force: true });
});

const importFile = (sourcePath: string) =>
  importImageFile({
    sourcePath,
    mediaDir: join(dir, "media"),
    churchId,
    category: "logo",
    media: createMediaRepository(database),
  });

describe("sniffImage", () => {
  it("identifies by magic bytes, not extension", () => {
    expect(sniffImage(PNG_1X1)).toEqual({ mime: "image/png", ext: "png" });
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(sniffImage(Buffer.from("GIF89a"))?.ext).toBe("gif");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))?.ext).toBe("webp");
    expect(
      sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")),
    ).toBeNull();
  });
});

describe("sniffMedia", () => {
  it("recognises MP4, MOV and WebM but not other Matroska", () => {
    expect(sniffMedia(Buffer.from("\0\0\0\x14ftypqt  "))?.mime).toBe(
      "video/quicktime",
    );
    expect(sniffMedia(Buffer.from("\0\0\0\x18ftypisom"))?.mime).toBe(
      "video/mp4",
    );
    expect(
      sniffMedia(
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("....webm")]),
      )?.ext,
    ).toBe("webm");
    expect(
      sniffMedia(
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("matroska")]),
      ),
    ).toBeNull();
  });
});

describe("importImageFile", () => {
  it("stores content-addressed and records the asset", async () => {
    const source = join(dir, "My Logo.png");
    writeFileSync(source, PNG_1X1);
    const asset = await importFile(source);
    expect(asset).toMatchObject({
      churchId,
      name: "My Logo.png",
      mediaType: "image",
      category: "logo",
      mimeType: "image/png",
      fileSize: PNG_1X1.byteLength,
    });
    expect(asset.filePath).toBe(
      `${asset.checksum.slice(0, 2)}/${asset.checksum}.png`,
    );
    expect(existsSync(join(dir, "media", asset.filePath))).toBe(true);
  });

  it("returns the existing asset for a duplicate import", async () => {
    writeFileSync(join(dir, "a.png"), PNG_1X1);
    writeFileSync(join(dir, "b.png"), PNG_1X1);
    const first = await importFile(join(dir, "a.png"));
    const second = await importFile(join(dir, "b.png"));
    expect(second.id).toBe(first.id);
  });

  it("rejects a non-image renamed to .png and leaves nothing behind", async () => {
    const source = join(dir, "evil.png");
    writeFileSync(source, "#!/bin/sh\necho pwned");
    await expect(importFile(source)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(existsSync(join(dir, "media"))).toBe(false);
  });

  it("reports a missing source file as NOT_FOUND", async () => {
    await expect(importFile(join(dir, "nope.png"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("leaves no temp files after a successful or duplicate copy", async () => {
    writeFileSync(join(dir, "a.png"), PNG_1X1);
    writeFileSync(join(dir, "b.png"), PNG_1X1);
    await importFile(join(dir, "a.png"));
    await importFile(join(dir, "b.png"));
    expect(
      readdirSync(join(dir, "media")).filter((f) => f.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("imports a video by streaming it when videos are accepted", async () => {
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypisom"),
      Buffer.alloc(1024 * 64, 7),
    ]);
    writeFileSync(join(dir, "clip.mp4"), mp4);
    const options = {
      sourcePath: join(dir, "clip.mp4"),
      mediaDir: join(dir, "media"),
      churchId,
      category: "test-deck",
      media: createMediaRepository(database),
    };
    await expect(
      importMediaFile({ ...options, accept: ["image"] }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const asset = await importMediaFile({
      ...options,
      accept: ["image", "video"],
    });
    expect(asset).toMatchObject({
      mediaType: "video",
      mimeType: "video/mp4",
      fileSize: mp4.byteLength,
    });
    expect(asset.filePath).toMatch(/\.mp4$/);
  });
});
