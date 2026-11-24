import type { SongSectionTypeName } from "@cmp/shared-types";

export const SECTION_NAMES: Record<SongSectionTypeName, string> = {
  intro: "Intro",
  verse: "Verse",
  pre_chorus: "Pre-chorus",
  chorus: "Chorus",
  bridge: "Bridge",
  refrain: "Refrain",
  tag: "Tag",
  outro: "Outro",
};

const SHORT: Record<SongSectionTypeName, string> = {
  intro: "I",
  verse: "V",
  pre_chorus: "PC",
  chorus: "C",
  bridge: "B",
  refrain: "R",
  tag: "T",
  outro: "O",
};

/** `V1`, `C`, `PC` … as on the arrangement chips. */
export function chipLabel(type: SongSectionTypeName, label: string): string {
  return `${SHORT[type]}${/(\d+)\s*$/.exec(label)?.[1] ?? ""}`;
}

/** Next free label for a new section of `type` ("Verse 3"). */
export function nextLabel(
  type: SongSectionTypeName,
  existing: { type: string; label: string }[],
): string {
  const count = existing.filter((section) => section.type === type).length;
  if (type === "verse") return `Verse ${count + 1}`;
  return count === 0
    ? SECTION_NAMES[type]
    : `${SECTION_NAMES[type]} ${count + 1}`;
}
