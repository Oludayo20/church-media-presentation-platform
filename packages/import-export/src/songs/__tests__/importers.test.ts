import { describe, expect, it } from "vitest";
import { detectSongFormat, parseSongFile, SongImportError } from "../index";

describe("plain text", () => {
  it("uses a leading title line, else the file name", () => {
    const titled = parseSongFile(
      "x.txt",
      "Morning Song\n\nVerse 1\nline one\n\nChorus\nline two",
    );
    expect(titled.title).toBe("Morning Song");
    expect(titled.sections.map((s) => s.label)).toEqual(["Verse 1", "Chorus"]);
    expect(parseSongFile("Evening Hymn.txt", "line one\nline two").title).toBe(
      "Evening Hymn",
    );
  });

  it("strips a UTF-8 byte-order mark", () => {
    expect(parseSongFile("x.txt", "\uFEFFMorning Song\n\nline one").title).toBe(
      "Morning Song",
    );
  });

  it("rejects empty files", () => {
    expect(() => parseSongFile("empty.txt", "   \n\n")).toThrow(
      SongImportError,
    );
  });
});

describe("CCLI SongSelect text", () => {
  const text = `Morning Song

Verse 1
Morning light is breaking
Over hills of green

Chorus
Sing a new song

CCLI Song # 7654321
A. Writer | B. Composer
© 2019 Example Music Publishing
For use solely with the SongSelect® Terms of Use.  All rights reserved. www.ccli.com
CCLI License # 11111`;

  it("reads title, sections and the footer", () => {
    expect(detectSongFormat("song.txt", text)).toBe("ccli-txt");
    const song = parseSongFile("song.txt", text);
    expect(song).toMatchObject({
      title: "Morning Song",
      artist: "A. Writer, B. Composer",
      ccliNumber: "7654321",
      copyrightYear: 2019,
      copyrightOwner: "Example Music Publishing",
    });
    expect(song.sections.map((s) => s.label)).toEqual(["Verse 1", "Chorus"]);
    expect(song.sections.flatMap((s) => s.lyrics.split("\n"))).not.toContain(
      "CCLI License # 11111",
    );
  });
});

describe("SongSelect .usr", () => {
  const usr = `[File]
Type=SongSelect Import File
Version=3.0
[S A7654321]
Title=Morning Song
Author=A. Writer|B. Composer
Copyright=© 2019 Example Music
Themes=Joy/tMorning
Fields=Verse 1/tChorus/tVerse 2
Words=Morning light/nOver hills/tSing a new song/tEvening stars/nShining bright
`;
  it("reads fields, words, themes and the CCLI number", () => {
    const song = parseSongFile("song.usr", usr);
    expect(song).toMatchObject({
      title: "Morning Song",
      artist: "A. Writer, B. Composer",
      ccliNumber: "7654321",
      copyrightYear: 2019,
      copyrightOwner: "Example Music",
      tags: ["Joy", "Morning"],
    });
    expect(song.sections.map((s) => [s.label, s.lyrics])).toEqual([
      ["Verse 1", "Morning light\nOver hills"],
      ["Chorus", "Sing a new song"],
      ["Verse 2", "Evening stars\nShining bright"],
    ]);
  });
});

describe("OpenLyrics", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9">
  <properties>
    <titles><title>Ọlọ́run Ńlá</title><title>Great God</title></titles>
    <authors><author>A. Writer</author></authors>
    <copyright>Example Music</copyright>
    <released>2021</released>
    <ccliNo>222</ccliNo>
    <verseOrder>v1 c v2 c</verseOrder>
    <themes><theme>Praise</theme></themes>
  </properties>
  <lyrics>
    <verse name="v1"><lines><chord name="G"/>Ọlọ́run mi<br/>ìwọ ni mo yìn</lines><lines>Second stanza</lines></verse>
    <verse name="c"><lines>Chorus &amp; praise<comment>repeat</comment></lines></verse>
    <verse name="v2"><lines>Verse two</lines></verse>
  </lyrics>
</song>`;

  it("reads properties, stanzas, chords removed and verse order", () => {
    expect(detectSongFormat("song.xml", xml)).toBe("openlyrics");
    const song = parseSongFile("song.xml", xml);
    expect(song).toMatchObject({
      title: "Ọlọ́run Ńlá",
      artist: "A. Writer",
      copyrightOwner: "Example Music",
      copyrightYear: 2021,
      ccliNumber: "222",
      tags: ["Praise"],
    });
    expect(song.sections.map((s) => [s.label, s.lyrics])).toEqual([
      ["Verse 1", "Ọlọ́run mi\nìwọ ni mo yìn\n\nSecond stanza"],
      ["Chorus", "Chorus & praise"],
      ["Verse 2", "Verse two"],
    ]);
    expect(song.arrangement).toEqual([0, 1, 2, 1]);
  });

  it("refuses DOCTYPE/ENTITY declarations (XXE, entity bombs)", () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE song [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<song xmlns="http://openlyrics.info/namespace/2009/song"><properties><titles><title>&x;</title></titles></properties></song>`;
    expect(() => parseSongFile("evil.xml", evil)).toThrow(/DOCTYPE/);
  });

  it("rejects non-song XML and oversized files", () => {
    expect(() => parseSongFile("other.xml", "<root/>")).toThrow(
      SongImportError,
    );
    expect(() => parseSongFile("big.txt", "x".repeat(300_000))).toThrow(
      /too large/,
    );
  });
});
