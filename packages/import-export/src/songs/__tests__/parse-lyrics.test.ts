import { describe, expect, it } from "vitest";
import { lyricsPlain, parseHeader, parseLyrics, shortLabel } from "../index";

describe("parseHeader", () => {
  it.each([
    ["Verse 1:", "verse", 1],
    ["[Chorus]", "chorus", null],
    ["V2", "verse", 2],
    ["C", "chorus", null],
    ["Pre-Chorus", "pre_chorus", null],
    ["PRE CHORUS 2", "pre_chorus", 2],
    ["(Bridge)", "bridge", null],
    ["Tag x2", "tag", null],
    ["Ending", "outro", null],
  ])("%s", (line, type, number) => {
    expect(parseHeader(line)).toEqual({ type, number });
  });

  it("does not treat lyric lines as headers", () => {
    for (const line of [
      "Verse of my heart",
      "Chorus of angels sing",
      "I will sing",
      "Come and see",
    ]) {
      expect(parseHeader(line)).toBeNull();
    }
  });
});

describe("parseLyrics", () => {
  it("splits on headers, keeps stanzas, and repeats a reused chorus", () => {
    const parsed = parseLyrics(`Verse 1
Morning light is breaking
Over hills of green

Every heart awaking

Chorus:
Sing, sing, sing a new song
Lift your voices high

Verse 2
Evening stars are shining
Chorus
`);
    expect(parsed.sections.map((s) => s.label)).toEqual([
      "Verse 1",
      "Chorus",
      "Verse 2",
    ]);
    expect(parsed.sections[0]!.lyrics).toBe(
      "Morning light is breaking\nOver hills of green\n\nEvery heart awaking",
    );
    expect(parsed.arrangement).toEqual([0, 1, 2, 1]);
  });

  it("numbers bare verse headers and treats leading lines as Verse 1", () => {
    const parsed = parseLyrics(
      "Opening line\n\nVerse\nSecond line\n\nVerse\nThird line",
    );
    expect(parsed.sections.map((s) => s.label)).toEqual([
      "Verse 1",
      "Verse 2",
      "Verse 3",
    ]);
  });

  it("without headers, stanzas become verses and a repeated stanza the chorus", () => {
    const parsed = parseLyrics(
      "A first verse\nline two\n\nThe refrain line\nagain\n\nA second verse\n\nThe refrain line\nagain",
    );
    expect(parsed.sections.map((s) => `${s.type}:${s.label}`)).toEqual([
      "verse:Verse 1",
      "chorus:Chorus",
      "verse:Verse 2",
    ]);
    expect(parsed.arrangement).toEqual([0, 1, 2, 1]);
  });

  it("keeps Yoruba and Igbo diacritics intact", () => {
    const parsed = parseLyrics(
      "Ẹsẹ 1\nỌlọ́run mi, ìwọ ni mo yìn\n\n[Chorus]\nChineke, ị dị ebube\nOnyenwe anyị",
    );
    const all = parsed.sections.map((s) => s.lyrics).join("\n");
    expect(all).toContain("Ọlọ́run mi, ìwọ ni mo yìn");
    expect(all).toContain("Onyenwe anyị");
    expect(lyricsPlain(parsed.sections)).toContain("ị dị ebube");
  });

  it("normalises Windows line endings and stray whitespace", () => {
    expect(
      parseLyrics("Verse 1\r\nLine one   \r\n\r\n\r\n\r\nLine two\r\n")
        .sections[0]!.lyrics,
    ).toBe("Line one\n\nLine two");
  });

  it("short labels for chips", () => {
    expect(shortLabel("verse", "Verse 2")).toBe("V2");
    expect(shortLabel("chorus", "Chorus")).toBe("C");
    expect(shortLabel("pre_chorus", "Pre-chorus")).toBe("PC");
  });
});
