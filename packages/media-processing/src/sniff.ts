/**
 * Identifies a file by its magic bytes (DOCUMENTATION.md §7 step 2), never
 * by its extension alone. Supported: images PNG/JPEG/WebP/GIF; video MP4,
 * MOV, WebM; audio MP3/WAV/AAC/M4A; documents PDF/PPTX; fonts TTF/OTF.
 * SVG (script-capable) and non-WebM Matroska (unreliable in Chromium) are
 * rejected.
 */
export type MediaKind = "image" | "video" | "audio" | "document" | "font";

export interface SniffedType {
  mediaType: MediaKind;
  mime: string;
  ext: string;
}

/** Bytes needed by `sniffMedia`. */
export const SNIFF_BYTES = 64;

export function sniffMedia(
  bytes: Uint8Array,
  fileName = "",
): SniffedType | null {
  const starts = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));
  const ext = fileName.toLowerCase().split(".").pop() ?? "";

  // Images
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mediaType: "image", mime: "image/png", ext: "png" };
  if (starts([0xff, 0xd8, 0xff]))
    return { mediaType: "image", mime: "image/jpeg", ext: "jpg" };
  if (ascii(0, 4) === "GIF8")
    return { mediaType: "image", mime: "image/gif", ext: "gif" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
    return { mediaType: "image", mime: "image/webp", ext: "webp" };

  // ISO base media (MP4/MOV/M4A)
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "qt  ")
      return { mediaType: "video", mime: "video/quicktime", ext: "mov" };
    if (brand === "M4A " || brand === "M4B ")
      return { mediaType: "audio", mime: "audio/mp4", ext: "m4a" };
    return { mediaType: "video", mime: "video/mp4", ext: "mp4" };
  }
  if (
    starts([0x1a, 0x45, 0xdf, 0xa3]) &&
    ascii(0, SNIFF_BYTES).includes("webm")
  )
    return { mediaType: "video", mime: "video/webm", ext: "webm" };

  // Audio
  if (
    ascii(0, 3) === "ID3" ||
    (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe6) === 0xe2)
  )
    return { mediaType: "audio", mime: "audio/mpeg", ext: "mp3" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE")
    return { mediaType: "audio", mime: "audio/wav", ext: "wav" };
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0)
    return { mediaType: "audio", mime: "audio/aac", ext: "aac" };

  // Documents
  if (ascii(0, 5) === "%PDF-")
    return { mediaType: "document", mime: "application/pdf", ext: "pdf" };
  if (starts([0x50, 0x4b, 0x03, 0x04]) && ext === "pptx")
    return {
      mediaType: "document",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ext: "pptx",
    };

  // Fonts
  if (starts([0x00, 0x01, 0x00, 0x00]) || ascii(0, 4) === "true")
    return { mediaType: "font", mime: "font/ttf", ext: "ttf" };
  if (ascii(0, 4) === "OTTO")
    return { mediaType: "font", mime: "font/otf", ext: "otf" };

  return null;
}
