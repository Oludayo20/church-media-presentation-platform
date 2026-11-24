import console from "node:console";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const [format, manifestPath, destination, ...sources] = process.argv.slice(2);
if (
  !["osis", "usfm", "zefania"].includes(format) ||
  !manifestPath ||
  !destination?.endsWith(".cmpbible") ||
  !sources.length
) {
  console.error(
    "Usage: prepare-bible <osis|usfm|zefania> <manifest.json> <out.cmpbible> <source> [source ...]",
  );
  process.exit(1);
}

const osisBooks =
  "Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev".split(
    " ",
  );
const usfmBooks =
  "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(
    " ",
  );
const omitXml = new Set([
  "note",
  "reference",
  "title",
  "caption",
  "REMARK",
  "xref",
]);

const clean = (text) => text.replace(/\s+/gu, " ").trim();
const sourceText = async (path) =>
  (await readFile(path, "utf8")).replace(/^\uFEFF/u, "");

function xmlNodes(text) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(text))
    throw new Error("XML document types and entities are unsupported");
  if (XMLValidator.validate(text) !== true)
    throw new Error("Invalid XML source");
  return new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
  }).parse(text);
}

function nodeText(nodes) {
  return nodes
    .map((node) =>
      Object.entries(node)
        .map(([tag, value]) => {
          if (tag === "#text") return value;
          if (omitXml.has(tag) || !Array.isArray(value)) return "";
          return nodeText(value);
        })
        .join(""),
    )
    .join("");
}

function osisRows(text) {
  const rows = [];
  let active;
  function visit(nodes) {
    for (const node of nodes) {
      const attrs = node[":@"] ?? {};
      if (node.verse) {
        if (attrs["@_eID"]) {
          if (!active || active.id !== attrs["@_eID"])
            throw new Error("Mismatched OSIS verse milestone");
          rows.push(active.row);
          active = undefined;
          continue;
        }
        const id = attrs["@_sID"] ?? attrs["@_osisID"];
        const address = /^(\w+)\.(\d+)\.(\d+)$/u.exec(id ?? "");
        if (!address || active)
          throw new Error(`Unsupported OSIS verse identifier: ${id}`);
        const row = {
          book: address[1],
          chapter: Number(address[2]),
          verse: Number(address[3]),
          text: nodeText(node.verse),
        };
        if (attrs["@_sID"]) active = { id, row };
        else rows.push(row);
        continue;
      }
      for (const [tag, content] of Object.entries(node)) {
        if (omitXml.has(tag)) continue;
        if (tag === "#text" && active) active.row.text += content;
        else if (Array.isArray(content)) visit(content);
      }
    }
  }
  visit(xmlNodes(text));
  if (active) throw new Error("Unclosed OSIS verse milestone");
  return rows;
}

function zefaniaRows(text) {
  const bible = xmlNodes(text).find((node) => node.XMLBIBLE)?.XMLBIBLE ?? [];
  return bible.flatMap((node) => {
    if (!node.BIBLEBOOK) return [];
    const attrs = node[":@"] ?? {};
    const canonical = osisBooks[Number(attrs["@_bnumber"]) - 1];
    const book = attrs["@_bname"] || canonical;
    const aliases = [canonical, attrs["@_bsname"]].filter(Boolean);
    return node.BIBLEBOOK.flatMap((chapter) =>
      (chapter.CHAPTER ?? []).flatMap((verse) => {
        if (!verse.VERS) return [];
        return [
          {
            book,
            aliases,
            chapter: Number(chapter[":@"]?.["@_cnumber"]),
            verse: Number(verse[":@"]?.["@_vnumber"]),
            text: nodeText(verse.VERS),
          },
        ];
      }),
    );
  });
}

function usfmRows(text) {
  const rows = [];
  let book;
  let chapter;
  let active;
  const stripped = text
    .replace(/\\(f|fe|x)\s[\s\S]*?\\\1\*/gu, "")
    .replace(/\\w\s+([^|\\]+)(?:\|[^\\]*)?\\w\*/gu, "$1");
  const marker = /\\(\+?[a-z][a-z0-9-]*)(\*)?([^\\]*)/giu;
  for (const match of stripped.matchAll(marker)) {
    const [, name, close, value] = match;
    const token = /^(\S+)\s*([\s\S]*)$/u.exec(value.trim());
    if (name === "id") {
      book = osisBooks[usfmBooks.indexOf(token?.[1])];
      if (!book) throw new Error(`Unsupported USFM book: ${token?.[1]}`);
      chapter = undefined;
      active = undefined;
    } else if (name === "c") {
      chapter = Number(token?.[1]);
      active = undefined;
    } else if (name === "v") {
      active = {
        book,
        chapter,
        verse: Number(token?.[1]),
        text: token?.[2] ?? "",
      };
      rows.push(active);
    } else if (
      active &&
      (close ||
        /^(?:q[1-4]?|p|m|pi[1-4]?|add|nd|wj|it|bd|em|sc|qs|qt)$/u.test(name))
    ) {
      active.text += close ? value : ` ${value}`;
    } else if (/^(?:s\d*|ms\d*|r|d|cl)$/u.test(name)) {
      active = undefined;
    }
  }
  return rows;
}

const convert = { osis: osisRows, usfm: usfmRows, zefania: zefaniaRows }[
  format
];
const rows = (
  await Promise.all(
    sources.map(async (path) => convert(await sourceText(path))),
  )
).flat();
if (!rows.length || rows.length > 100_000)
  throw new Error("Expected 1 to 100,000 verses");
const seen = new Set();
for (const row of rows) {
  row.text = clean(row.text);
  const key = JSON.stringify([row.book, row.chapter, row.verse]);
  if (
    !row.book ||
    row.book.length > 100 ||
    !Number.isInteger(row.chapter) ||
    row.chapter < 1 ||
    row.chapter > 200 ||
    !Number.isInteger(row.verse) ||
    row.verse < 1 ||
    row.verse > 300 ||
    !row.text ||
    row.text.length > 6000 ||
    seen.has(key)
  ) {
    throw new Error(`Invalid, compound or duplicate verse: ${key}`);
  }
  seen.add(key);
}
const verses = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
const checksum = createHash("sha256").update(verses).digest("hex");
const manifest = { ...JSON.parse(await sourceText(manifestPath)), checksum };
if (
  !/^[A-Z0-9_-]{1,16}$/u.test(manifest.code ?? "") ||
  ["name", "language", "licence", "attribution", "versification"].some(
    (field) => typeof manifest[field] !== "string" || !manifest[field].trim(),
  )
) {
  throw new Error(
    "Manifest requires code, name, language, licence, attribution and versification",
  );
}
const temp = await mkdtemp(join(tmpdir(), "cmpbible-"));
try {
  await writeFile(
    join(temp, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(join(temp, "verses.jsonl"), verses);
  execFileSync(
    "zip",
    ["-q", "translation.zip", "manifest.json", "verses.jsonl"],
    { cwd: temp },
  );
  await copyFile(
    join(temp, "translation.zip"),
    resolve(destination),
    constants.COPYFILE_EXCL,
  );
  console.log(`Wrote ${basename(destination)} with ${rows.length} verses`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
