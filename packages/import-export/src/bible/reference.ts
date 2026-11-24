interface ReferenceBook {
  id: number;
  name: string;
  aliases: string[];
}

interface VerseAddress {
  chapter: number;
  verse: number;
}

const englishAliases = [
  "Genesis Gen Ge Gn",
  "Exodus Exod Ex",
  "Leviticus Lev Lv",
  "Numbers Num Nu Nm",
  "Deuteronomy Deut Dt",
  "Joshua Josh Jos",
  "Judges Judg Jdg",
  "Ruth Ru",
  "1 Samuel 1Sam 1Sa",
  "2 Samuel 2Sam 2Sa",
  "1 Kings 1Kgs 1Ki",
  "2 Kings 2Kgs 2Ki",
  "1 Chronicles 1Chr 1Ch",
  "2 Chronicles 2Chr 2Ch",
  "Ezra Ezr",
  "Nehemiah Neh Ne",
  "Esther Esth Est",
  "Job Jb",
  "Psalms Psalm Ps Psa Pss",
  "Proverbs Prov Pr",
  "Ecclesiastes Eccl Ecc",
  "Song of Solomon|Song of Songs|Song|Canticles|Cant",
  "Isaiah Isa Is",
  "Jeremiah Jer Je",
  "Lamentations Lam La",
  "Ezekiel Ezek Eze",
  "Daniel Dan Dn",
  "Hosea Hos Ho",
  "Joel Jl",
  "Amos Am",
  "Obadiah Obad Ob",
  "Jonah Jon",
  "Micah Mic",
  "Nahum Nah Na",
  "Habakkuk Hab Hb",
  "Zephaniah Zeph Zep",
  "Haggai Hag Hg",
  "Zechariah Zech Zec",
  "Malachi Mal",
  "Matthew Matt Mt",
  "Mark Mk Mrk",
  "Luke Lk Luk",
  "John Jn Joh Jhn",
  "Acts Ac",
  "Romans Rom Ro",
  "1 Corinthians 1Cor 1Co",
  "2 Corinthians 2Cor 2Co",
  "Galatians Gal Ga",
  "Ephesians Eph Ep",
  "Philippians Phil Php",
  "Colossians Col",
  "1 Thessalonians 1Thess 1Th",
  "2 Thessalonians 2Thess 2Th",
  "1 Timothy 1Tim 1Ti",
  "2 Timothy 2Tim 2Ti",
  "Titus Tit",
  "Philemon Phlm Phm",
  "Hebrews Heb",
  "James Jas Jm",
  "1 Peter 1Pet 1Pe",
  "2 Peter 2Pet 2Pe",
  "1 John 1Jn 1Joh",
  "2 John 2Jn 2Joh",
  "3 John 3Jn 3Joh",
  "Jude Jud",
  "Revelation Rev Re Apoc",
].map((book) =>
  book.includes("|") ? book.split("|") : book.match(/^\d \S+|\S+/gu)!,
);

function normalise(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[.\s]/gu, "");
}

export function matchBibleBook(input: string, books: ReferenceBook[]) {
  const match = /^(.+?)(\d[\d\s:.,–—-]*)$/u.exec(input.trim());
  if (!match) return null;
  const prefix = normalise(match[1]!);
  const matching = books.filter((book) => {
    const aliases = [book.name, ...book.aliases].map(normalise);
    const canonical = englishAliases.find((names) =>
      names.some((name) => aliases.includes(normalise(name))),
    );
    return (
      aliases.includes(prefix) ||
      canonical?.some((name) => normalise(name) === prefix)
    );
  });
  return matching.length === 1
    ? { book: matching[0]!, address: match[2]! }
    : null;
}

/** Resolve references against actual verse addresses, including omitted verse numbers. */
export function selectBibleVerses<T extends VerseAddress>(
  address: string,
  verses: T[],
): T[] | null {
  const input = address.trim().replace(/[–—]/gu, "-").replace(/\s+/gu, " ");
  const wholeChapter = /^\d+$/u.exec(input);
  if (wholeChapter) {
    const chapter = verses.filter((verse) => verse.chapter === Number(input));
    return chapter.length ? chapter : null;
  }
  const start = /^(\d+)(?:\s*[:.]\s*| )(\d+.*)$/u.exec(input);
  if (!start) return null;
  let chapter = Number(start[1]);
  const positions = new Map(
    verses.map((verse, index) => [`${verse.chapter}:${verse.verse}`, index]),
  );
  const selected = new Set<number>();
  for (const entry of start[2]!.split(",")) {
    const range =
      /^(?:(\d+)\s*[:.]\s*)?(\d+)(?:\s*-\s*(?:(\d+)\s*[:.]\s*)?(\d+))?$/u.exec(
        entry.trim(),
      );
    if (!range) return null;
    chapter = Number(range[1] ?? chapter);
    const endChapter = Number(range[3] ?? chapter);
    const first = positions.get(`${chapter}:${Number(range[2])}`);
    const last = positions.get(`${endChapter}:${Number(range[4] ?? range[2])}`);
    if (
      first === undefined ||
      last === undefined ||
      last < first ||
      last - first >= 500
    )
      return null;
    for (let position = first; position <= last; position++)
      selected.add(position);
    if (selected.size > 500) return null;
    chapter = endChapter;
  }
  return [...selected].sort((a, b) => a - b).map((index) => verses[index]!);
}
