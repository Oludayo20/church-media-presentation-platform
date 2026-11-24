/** Song structure shared by the parser, importers and slide generator. */
export const SECTION_TYPES = [
  "intro",
  "verse",
  "pre_chorus",
  "chorus",
  "bridge",
  "refrain",
  "tag",
  "outro",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_NAMES: Record<SectionType, string> = {
  intro: "Intro",
  verse: "Verse",
  pre_chorus: "Pre-chorus",
  chorus: "Chorus",
  bridge: "Bridge",
  refrain: "Refrain",
  tag: "Tag",
  outro: "Outro",
};

const SHORT: Record<SectionType, string> = {
  intro: "I",
  verse: "V",
  pre_chorus: "PC",
  chorus: "C",
  bridge: "B",
  refrain: "R",
  tag: "T",
  outro: "O",
};

/** `V1`, `C`, `C2`, `PC` … for arrangement chips. */
export function shortLabel(type: SectionType, label: string): string {
  const number = /(\d+)\s*$/.exec(label)?.[1] ?? "";
  return `${SHORT[type]}${number}`;
}

/** A section before it has an id (parser/importer output). */
export interface ParsedSection {
  type: SectionType;
  label: string;
  /** Lines separated by "\n"; stanzas by a blank line. */
  lyrics: string;
}

/** A parsed or imported song, ready to be saved. */
export interface ParsedSong {
  title: string;
  artist: string | null;
  copyrightOwner: string | null;
  copyrightYear: number | null;
  ccliNumber: string | null;
  tags: string[];
  sections: ParsedSection[];
  /** Indexes into `sections`, in performance order. */
  arrangement: number[];
}

export function emptySong(title: string): ParsedSong {
  return {
    title,
    artist: null,
    copyrightOwner: null,
    copyrightYear: null,
    ccliNumber: null,
    tags: [],
    sections: [],
    arrangement: [],
  };
}
