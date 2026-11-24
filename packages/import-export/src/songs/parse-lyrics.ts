import { SECTION_NAMES, type ParsedSection, type SectionType } from "./model";

const HEADER =
  /^\s*[[(]?\s*(verse|v|chorus|ch|c|pre[- ]?chorus|prechorus|pc|bridge|b|refrain|r|tag|t|intro|i|outro|o|ending|end|coda)\s*(\d+)?\s*[\])]?\s*:?\s*(?:\((?:x|×)\s*\d+\)|x\s*\d+)?\s*$/i;

const TYPE_BY_WORD: Record<string, SectionType> = {
  verse: "verse",
  v: "verse",
  chorus: "chorus",
  ch: "chorus",
  c: "chorus",
  "pre-chorus": "pre_chorus",
  "pre chorus": "pre_chorus",
  prechorus: "pre_chorus",
  pc: "pre_chorus",
  bridge: "bridge",
  b: "bridge",
  refrain: "refrain",
  r: "refrain",
  tag: "tag",
  t: "tag",
  intro: "intro",
  i: "intro",
  outro: "outro",
  o: "outro",
  ending: "outro",
  end: "outro",
  coda: "outro",
};

/** Recognises a section header line such as `Verse 1:`, `[Chorus]`, `V2`. */
export function parseHeader(
  line: string,
): { type: SectionType; number: number | null } | null {
  const match = HEADER.exec(line);
  if (!match) return null;
  const word = match[1]!.toLowerCase().replace(/\s+/, " ");
  const type = TYPE_BY_WORD[word] ?? TYPE_BY_WORD[word.replace(" ", "-")];
  if (!type) return null;
  return { type, number: match[2] ? Number(match[2]) : null };
}

/** Normalises line endings, trims line ends, collapses 3+ blank lines. */
export function normaliseLyrics(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * DOCUMENTATION.md §5.2 step 1. Header lines start sections; blank lines
 * separate stanzas inside a section. A repeated header (`Chorus` again,
 * with the same or no lyrics) reuses the section in the arrangement.
 * Without any headers, each stanza becomes a verse — except a stanza that
 * repeats word for word, which becomes the chorus.
 */
export function parseLyrics(text: string): {
  sections: ParsedSection[];
  arrangement: number[];
} {
  const lines = normaliseLyrics(text).split("\n");
  const hasHeaders = lines.some((line) => parseHeader(line));
  return hasHeaders ? parseWithHeaders(lines) : parseStanzas(lines);
}

function parseWithHeaders(lines: string[]) {
  const sections: ParsedSection[] = [];
  const arrangement: number[] = [];
  const counts = new Map<SectionType, number>();
  let current: { type: SectionType; label: string; body: string[] } | null =
    null;

  const flush = () => {
    if (!current) return;
    const lyrics = normaliseLyrics(current.body.join("\n"));
    const existing = sections.findIndex(
      (section) =>
        section.label === current!.label &&
        (lyrics === "" || section.lyrics === lyrics),
    );
    if (existing >= 0) {
      arrangement.push(existing);
    } else if (lyrics !== "") {
      sections.push({ type: current.type, label: current.label, lyrics });
      arrangement.push(sections.length - 1);
    }
    current = null;
  };

  for (const line of lines) {
    const header = parseHeader(line);
    if (header) {
      flush();
      const count = (counts.get(header.type) ?? 0) + 1;
      const number = header.number ?? (header.type === "verse" ? count : null);
      if (
        header.number === null ||
        header.number > (counts.get(header.type) ?? 0)
      ) {
        counts.set(header.type, Math.max(count, header.number ?? 0));
      }
      current = {
        type: header.type,
        label: number
          ? `${SECTION_NAMES[header.type]} ${number}`
          : SECTION_NAMES[header.type],
        body: [],
      };
      continue;
    }
    if (!current) {
      if (line.trim() === "") continue;
      current = { type: "verse", label: "Verse 1", body: [] };
      counts.set("verse", 1);
    }
    current.body.push(line);
  }
  flush();
  return { sections, arrangement };
}

function parseStanzas(lines: string[]) {
  const stanzas = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((stanza) => stanza.trim())
    .filter(Boolean);
  const repeated = new Set(
    stanzas.filter((stanza, index) => stanzas.indexOf(stanza) !== index),
  );
  const sections: ParsedSection[] = [];
  const arrangement: number[] = [];
  let verse = 0;
  let chorus = 0;
  for (const stanza of stanzas) {
    const existing = sections.findIndex((section) => section.lyrics === stanza);
    if (existing >= 0) {
      arrangement.push(existing);
      continue;
    }
    if (repeated.has(stanza)) {
      chorus += 1;
      sections.push({
        type: "chorus",
        label: chorus === 1 ? "Chorus" : `Chorus ${chorus}`,
        lyrics: stanza,
      });
    } else {
      verse += 1;
      sections.push({ type: "verse", label: `Verse ${verse}`, lyrics: stanza });
    }
    arrangement.push(sections.length - 1);
  }
  return { sections, arrangement };
}

/** Plain text of the lyrics, for search (`songs_fts.lyrics_plain`). */
export function lyricsPlain(sections: { lyrics: string }[]): string {
  return sections
    .map((section) => section.lyrics.replace(/\s+/g, " "))
    .join(" ");
}
