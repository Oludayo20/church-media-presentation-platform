export interface BibleTranslation {
  code: string;
  name: string;
  language: string;
  licence: string;
  attribution: string;
  versification: string;
  checksum: string;
}

export interface BibleBook {
  id: number;
  name: string;
  position: number;
  aliases: string[];
}

export interface BibleVerse {
  chapter: number;
  verse: number;
  text: string;
}

export interface BibleImportVerse extends BibleVerse {
  book: string;
  aliases?: string[] | undefined;
}
