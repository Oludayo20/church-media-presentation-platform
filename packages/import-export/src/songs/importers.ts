import { XMLParser } from "fast-xml-parser";
import {
  emptySong,
  SECTION_NAMES,
  type ParsedSection,
  type ParsedSong,
  type SectionType,
} from "./model";
import { normaliseLyrics, parseLyrics } from "./parse-lyrics";

export type SongFileFormat = "txt" | "ccli-txt" | "usr" | "openlyrics";

export class SongImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SongImportError";
  }
}

const MAX_CHARS = 200_000;

/** Picks the parser from the file name and content (never trusts one alone). */
export function detectSongFormat(
  fileName: string,
  text: string,
): SongFileFormat | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const head = text.slice(0, 2000);
  if (/<song[\s>]/.test(head) && /openlyrics/i.test(head)) return "openlyrics";
  if (ext === "usr" || /^\s*\[File\][\s\S]*Type=SongSelect/i.test(head))
    return "usr";
  if (/CCLI Song #\s*\d+/i.test(text)) return "ccli-txt";
  if (ext === "txt" || ext === "") return "txt";
  if (ext === "xml") return null;
  return null;
}

export function parseSongFile(fileName: string, text: string): ParsedSong {
  if (text.length > MAX_CHARS)
    throw new SongImportError("This file is too large to be a song");
  const clean = text.replace(/^\uFEFF/, "");
  const format = detectSongFormat(fileName, clean);
  switch (format) {
    case "openlyrics":
      return parseOpenLyrics(clean);
    case "usr":
      return parseUsr(clean);
    case "ccli-txt":
      return parseCcliText(clean);
    case "txt":
      return parsePlainText(fileName, clean);
    default:
      throw new SongImportError(
        "Not a song file (plain text, OpenLyrics or SongSelect)",
      );
  }
}

/**
 * Plain text: the first line is the title when a blank line follows it;
 * otherwise the file name is the title. The rest goes through parseLyrics.
 */
export function parsePlainText(fileName: string, text: string): ParsedSong {
  const lines = normaliseLyrics(text).split("\n");
  const titled =
    lines.length > 2 &&
    lines[0]!.trim() !== "" &&
    lines[1]!.trim() === "" &&
    lines[0]!.length <= 100;
  const title = titled
    ? lines[0]!.trim()
    : fileName.replace(/\.[^.]+$/, "").trim() || "Untitled song";
  const body = (titled ? lines.slice(2) : lines).join("\n");
  const { sections, arrangement } = parseLyrics(body);
  if (sections.length === 0) throw new SongImportError("No lyrics found");
  return { ...emptySong(title), sections, arrangement };
}

/**
 * CCLI SongSelect plain-text export: title, sections, then a footer with
 * `CCLI Song #`, authors (`|` separated), `©` line and licence boilerplate.
 */
export function parseCcliText(text: string): ParsedSong {
  const lines = normaliseLyrics(text).split("\n");
  const footerStart = lines.findIndex((line) =>
    /^CCLI Song #/i.test(line.trim()),
  );
  const body = lines.slice(0, footerStart < 0 ? lines.length : footerStart);
  const footer = footerStart < 0 ? [] : lines.slice(footerStart);
  const titleIndex = body.findIndex((line) => line.trim() !== "");
  const song = emptySong(body[titleIndex]?.trim() || "Untitled song");

  const ccli = /CCLI Song #\s*(\d+)/i.exec(footer[0] ?? "");
  song.ccliNumber = ccli?.[1] ?? null;
  for (const line of footer.slice(1)) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      /For use solely|CCLI Licen[cs]e #|www\.ccli\.com/i.test(trimmed)
    )
      continue;
    const copyright = /^(?:©|\(c\)|Copyright)\s*(\d{4})?\s*(.*)$/i.exec(
      trimmed,
    );
    if (copyright) {
      song.copyrightYear = copyright[1] ? Number(copyright[1]) : null;
      song.copyrightOwner = copyright[2]?.trim() || null;
    } else if (!song.artist) {
      song.artist = trimmed
        .split("|")
        .map((name) => name.trim())
        .filter(Boolean)
        .join(", ");
    }
  }
  const { sections, arrangement } = parseLyrics(
    body.slice(titleIndex + 1).join("\n"),
  );
  if (sections.length === 0) throw new SongImportError("No lyrics found");
  return { ...song, sections, arrangement };
}

/**
 * CCLI SongSelect `.usr`: INI-style, `Fields=` and `Words=` hold sections
 * separated by `/t`, lines by `/n`; `[S A1234567]` carries the CCLI number.
 */
export function parseUsr(text: string): ParsedSong {
  const values = new Map<string, string>();
  let ccli: string | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const section = /^\[S\s+A?(\d+)\]$/i.exec(line);
    if (section) ccli = section[1]!;
    const pair = /^([A-Za-z]+)=(.*)$/.exec(line);
    if (pair) values.set(pair[1]!.toLowerCase(), pair[2]!);
  }
  const song = emptySong(values.get("title")?.trim() || "Untitled song");
  song.ccliNumber = ccli;
  song.artist =
    (values.get("author") ?? "")
      .split("|")
      .map((a) => a.trim())
      .filter(Boolean)
      .join(", ") || null;
  const copyright = values.get("copyright")?.trim() ?? "";
  const year = /\b(\d{4})\b/.exec(copyright);
  song.copyrightYear = year ? Number(year[1]) : null;
  song.copyrightOwner =
    copyright
      .replace(/^(©|\(c\))\s*/i, "")
      .replace(/\b\d{4}\b\s*/, "")
      .trim() || null;
  song.tags = (values.get("themes") ?? "")
    .split("/t")
    .map((t) => t.trim())
    .filter(Boolean);

  const fields = (values.get("fields") ?? "").split("/t");
  const words = (values.get("words") ?? "").split("/t");
  const labelled = fields
    .map((field, index) => ({
      header: field.trim(),
      lyrics: (words[index] ?? "").split("/n").join("\n"),
    }))
    .filter((entry) => entry.lyrics.trim() !== "");
  const text2 = labelled
    .map((entry) => `${entry.header || "Verse"}\n${entry.lyrics}`)
    .join("\n\n");
  const { sections, arrangement } = parseLyrics(text2);
  if (sections.length === 0) throw new SongImportError("No lyrics found");
  return { ...song, sections, arrangement };
}

const OPENLYRICS_TYPES: Record<string, SectionType> = {
  v: "verse",
  c: "chorus",
  p: "pre_chorus",
  b: "bridge",
  i: "intro",
  e: "outro",
  o: "tag",
};

/**
 * OpenLyrics 0.8/0.9 XML. DOCTYPE/ENTITY declarations are refused outright
 * (XXE and entity-expansion bombs, SECURITY.md). Chords and comments are
 * dropped; `<br/>` becomes a line break; several `<lines>` in a verse are
 * stanzas; `verseOrder` becomes the arrangement.
 */
export function parseOpenLyrics(text: string): ParsedSong {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new SongImportError(
      "XML with DOCTYPE or ENTITY declarations is not accepted",
    );
  const prepared = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<chord\b[^>]*\/>/gi, "")
    .replace(/<chord\b[^>]*>([\s\S]*?)<\/chord>/gi, "$1")
    .replace(/<comment\b[^>]*>[\s\S]*?<\/comment>/gi, "");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    processEntities: true,
    htmlEntities: false,
    trimValues: false,
    isArray: (name) =>
      ["title", "author", "verse", "lines", "theme"].includes(name),
  });
  let document: Record<string, unknown>;
  try {
    document = parser.parse(prepared) as Record<string, unknown>;
  } catch {
    throw new SongImportError("This OpenLyrics file is not valid XML");
  }
  const root = document["song"] as Record<string, unknown> | undefined;
  if (!root) throw new SongImportError("Not an OpenLyrics song");
  const properties = (root["properties"] ?? {}) as Record<string, unknown>;
  const text0 = (value: unknown): string =>
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : value && typeof value === "object" && "#text" in value
        ? String((value as { "#text": unknown })["#text"])
        : "";

  const titles = ((
    properties["titles"] as Record<string, unknown> | undefined
  )?.["title"] ?? []) as unknown[];
  const song = emptySong(text0(titles[0]).trim() || "Untitled song");
  const authors = ((
    properties["authors"] as Record<string, unknown> | undefined
  )?.["author"] ?? []) as unknown[];
  song.artist =
    authors
      .map((author) => text0(author).trim())
      .filter(Boolean)
      .join(", ") || null;
  song.copyrightOwner = text0(properties["copyright"]).trim() || null;
  const released = /\b(\d{4})\b/.exec(text0(properties["released"]));
  song.copyrightYear = released ? Number(released[1]) : null;
  song.ccliNumber = text0(properties["ccliNo"]).trim() || null;
  const themes = ((
    properties["themes"] as Record<string, unknown> | undefined
  )?.["theme"] ?? []) as unknown[];
  song.tags = themes.map((theme) => text0(theme).trim()).filter(Boolean);

  const verses = ((root["lyrics"] as Record<string, unknown> | undefined)?.[
    "verse"
  ] ?? []) as Record<string, unknown>[];
  const sections: ParsedSection[] = [];
  const names: string[] = [];
  const counts = new Map<SectionType, number>();
  for (const verse of verses) {
    const name = String(verse["@name"] ?? "").toLowerCase();
    const type = OPENLYRICS_TYPES[name[0] ?? "v"] ?? "verse";
    const number = /\d+/.exec(name)?.[0];
    const count = (counts.get(type) ?? 0) + 1;
    counts.set(type, count);
    const lines = ((verse["lines"] ?? []) as unknown[]).map((entry) =>
      normaliseLyrics(text0(entry)),
    );
    const lyrics = lines.filter(Boolean).join("\n\n");
    if (!lyrics) continue;
    const label = number
      ? `${SECTION_NAMES[type]} ${number}`
      : type === "verse"
        ? `Verse ${count}`
        : SECTION_NAMES[type];
    sections.push({ type, label, lyrics });
    names.push(name);
  }
  if (sections.length === 0) throw new SongImportError("No lyrics found");
  const order = text0(properties["verseOrder"])
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const arrangement = order.length
    ? order.map((name) => names.indexOf(name)).filter((index) => index >= 0)
    : sections.map((_, index) => index);
  return {
    ...song,
    sections,
    arrangement: arrangement.length ? arrangement : sections.map((_, i) => i),
  };
}
