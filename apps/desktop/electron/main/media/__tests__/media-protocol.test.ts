import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { silentLogger } from "../../logging/logger";
import {
  createMediaProtocolHandler,
  type MediaLookup,
} from "../media-protocol";

// Valid ULIDs (Crockford base32: no I, L, O or U).
const IDS = {
  good: "01JD0000000000000000000001",
  traversal: "01JD0000000000000000000002",
  absolute: "01JD0000000000000000000003",
  symlink: "01JD0000000000000000000004",
  missing: "01JD0000000000000000000005",
};
const UNKNOWN_ID = "01JD0000000000000000000009";

let root: string;
let mediaDir: string;
let handler: (request: Request) => Promise<Response>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cmp-media-"));
  mediaDir = join(root, "workspace", "media");
  mkdirSync(join(mediaDir, "ab"), { recursive: true });
  writeFileSync(join(mediaDir, "ab", "abc.png"), Buffer.from("0123456789"));
  writeFileSync(join(root, "secret.txt"), "top secret");
  symlinkSync(join(root, "secret.txt"), join(mediaDir, "ab", "link.png"));

  const assets: Record<string, { filePath: string; mimeType: string }> = {
    [IDS.good]: { filePath: "ab/abc.png", mimeType: "image/png" },
    [IDS.traversal]: { filePath: "../../secret.txt", mimeType: "text/plain" },
    [IDS.absolute]: {
      filePath: join(root, "secret.txt"),
      mimeType: "text/plain",
    },
    [IDS.symlink]: { filePath: "ab/link.png", mimeType: "image/png" },
    [IDS.missing]: { filePath: "ab/gone.png", mimeType: "image/png" },
  };
  const lookup: MediaLookup = {
    find: async (kind, id) => {
      if (kind === "thumb") {
        return id === IDS.good
          ? { root: mediaDir, filePath: "ab/abc.png", mimeType: "image/webp" }
          : null;
      }
      const asset = assets[id];
      return asset ? { root: mediaDir, ...asset } : null;
    },
  };
  handler = createMediaProtocolHandler(lookup, silentLogger);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const get = (url: string, headers: Record<string, string> = {}) =>
  handler(new Request(url, { headers }));

describe("cmp-media:// handler", () => {
  it("serves an asset with its MIME type", async () => {
    const response = await get(`cmp-media://asset/${IDS.good}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("0123456789");
  });

  it("serves byte ranges with 206 and Content-Range", async () => {
    const response = await get(`cmp-media://asset/${IDS.good}`, {
      Range: "bytes=2-5",
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
  });

  it("answers 416 for an unsatisfiable range", async () => {
    const response = await get(`cmp-media://asset/${IDS.good}`, {
      Range: "bytes=50-",
    });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });

  it("rejects a stored path that traverses out of the media dir", async () => {
    const response = await get(`cmp-media://asset/${IDS.traversal}`);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("secret");
  });

  it("rejects an absolute stored path", async () => {
    expect((await get(`cmp-media://asset/${IDS.absolute}`)).status).toBe(403);
  });

  it("rejects a symlink that points outside the media dir", async () => {
    expect((await get(`cmp-media://asset/${IDS.symlink}`)).status).toBe(403);
  });

  it("rejects paths and malformed ids in the URL itself", async () => {
    for (const url of [
      "cmp-media://asset/..%2F..%2Fsecret.txt",
      "cmp-media://asset/../../secret.txt",
      "cmp-media://asset/not-a-ulid",
      `cmp-media://other/${IDS.good}`,
    ]) {
      expect((await get(url)).status, url).toBe(400);
    }
  });

  it("answers 404 for unknown assets and missing files", async () => {
    expect((await get(`cmp-media://asset/${UNKNOWN_ID}`)).status).toBe(404);
    expect((await get(`cmp-media://asset/${IDS.missing}`)).status).toBe(404);
  });

  it("serves thumbnails on the thumb route", async () => {
    const response = await get(`cmp-media://thumb/${IDS.good}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect((await get(`cmp-media://thumb/${IDS.missing}`)).status).toBe(404);
  });

  it("adds CORS only to fonts (FontFace from file:// pages)", async () => {
    expect(
      (await get(`cmp-media://asset/${IDS.good}`)).headers.get(
        "access-control-allow-origin",
      ),
    ).toBeNull();
    const fontHandler = createMediaProtocolHandler(
      {
        find: async () => ({
          root: mediaDir,
          filePath: "ab/abc.png",
          mimeType: "font/ttf",
        }),
      },
      silentLogger,
    );
    const response = await fontHandler(
      new Request(`cmp-media://asset/${IDS.good}`),
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("only allows GET and HEAD", async () => {
    const response = await handler(
      new Request(`cmp-media://asset/${IDS.good}`, { method: "POST" }),
    );
    expect(response.status).toBe(405);
  });
});
