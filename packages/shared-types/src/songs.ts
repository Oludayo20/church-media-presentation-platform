export type SongSectionTypeName =
  | "intro"
  | "verse"
  | "pre_chorus"
  | "chorus"
  | "bridge"
  | "refrain"
  | "tag"
  | "outro";

export interface SongSplitSettings {
  mode: "lines" | "chars";
  linesPerSlide: number;
  maxChars: number;
  blankBetweenSections: boolean;
}

export interface SongSectionData {
  id: string;
  type: SongSectionTypeName;
  label: string;
  lyrics: string;
}

/** A song as edited and saved (`songs:*`). */
export interface SongData {
  title: string;
  artist: string | null;
  language: string;
  category: string | null;
  copyrightOwner: string | null;
  copyrightYear: number | null;
  ccliNumber: string | null;
  licenceReference: string | null;
  tags: string[];
  collectionIds: string[];
  backgroundAssetId: string | null;
  templateId: string | null;
  /** Null = use the workspace default (`songs.split`). */
  split: SongSplitSettings | null;
  sections: SongSectionData[];
  /** Section ids in performance order, repeats allowed. */
  arrangement: string[];
}

export interface SongDetail extends SongData {
  id: string;
  isFavourite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SongListItem {
  id: string;
  title: string;
  artist: string | null;
  language: string;
  sectionCount: number;
  snippet: string | null;
}

export interface SongCollectionInfo {
  id: string;
  name: string;
  songCount: number;
}
