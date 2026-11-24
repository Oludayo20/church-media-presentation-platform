import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { isUlid } from "@cmp/database";
import type { Logger } from "../logging/logger";
import { parseRange } from "./range";

export const MEDIA_SCHEME = "cmp-media";

export type MediaKindRoute = "asset" | "thumb";

export interface MediaLookup {
  /**
   * Resolves `cmp-media://<kind>/<id>` to a stored relative path, the
   * directory it must stay inside, and a MIME type — or null.
   */
  find(
    kind: MediaKindRoute,
    id: string,
  ): Promise<{
    root: string;
    filePath: string;
    mimeType: string | null;
  } | null>;
}

/**
 * Handler for `cmp-media://asset/<assetId>` and the asset's thumbnail
 * `cmp-media://thumb/<assetId>` (DOCUMENTATION.md §2.1,
 * SECURITY.md). The URL carries only an asset id, never a path. The id is
 * resolved through the database, and the resulting file must sit inside the
 * workspace media directory after symlinks are resolved. Supports `Range` so
 * `<video>` can seek.
 */
export function createMediaProtocolHandler(
  lookup: MediaLookup,
  logger: Logger,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return text(405, "Method not allowed");
    }

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return text(400, "Bad request");
    }
    const assetId = url.pathname.replace(/^\//, "");
    const kind = url.hostname;
    if (
      url.protocol !== `${MEDIA_SCHEME}:` ||
      (kind !== "asset" && kind !== "thumb") ||
      !isUlid(assetId)
    ) {
      return text(400, "Bad request");
    }

    const asset = await lookup.find(kind, assetId);
    if (!asset) return text(404, "Not found");

    const filePath = await confine(asset.root, asset.filePath);
    if (filePath === "outside") {
      logger.warn(`[cmp-media] blocked ${assetId}: path escapes media dir`);
      return text(403, "Forbidden");
    }
    if (filePath === "missing") return text(404, "Not found");

    const { size } = await stat(filePath);
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      "Content-Type": asset.mimeType ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    // Fonts load through FontFace/@font-face, which is a CORS request from
    // the app's own pages (file:// has an opaque origin).
    if (asset.mimeType?.startsWith("font/"))
      headers.set("Access-Control-Allow-Origin", "*");

    const range = parseRange(request.headers.get("range"), size);
    if (range.kind === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }

    const { start, end } =
      range.kind === "partial" ? range.range : { start: 0, end: size - 1 };
    const length = size === 0 ? 0 : end - start + 1;
    headers.set("Content-Length", String(length));
    if (range.kind === "partial") {
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    const status = range.kind === "partial" ? 206 : 200;

    if (request.method === "HEAD" || length === 0) {
      return new Response(null, { status, headers });
    }
    const body = Readable.toWeb(
      createReadStream(filePath, { start, end }),
    ) as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  };
}

/** Resolves `storedPath` under `mediaDir`, following symlinks. */
async function confine(
  mediaDir: string,
  storedPath: string,
): Promise<string | "outside" | "missing"> {
  if (isAbsolute(storedPath)) return "outside";
  let root: string;
  let target: string;
  try {
    root = await realpath(mediaDir);
  } catch {
    return "missing";
  }
  // Check the lexical path first so traversal is reported even if the
  // target does not exist.
  if (escapes(resolve(root, storedPath), root)) return "outside";
  try {
    target = await realpath(resolve(root, storedPath));
  } catch {
    return "missing";
  }
  return escapes(target, root) ? "outside" : target;
}

function escapes(target: string, root: string): boolean {
  const rel = relative(root, target);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel);
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
