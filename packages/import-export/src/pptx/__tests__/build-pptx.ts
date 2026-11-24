import { writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";

/** Writes a real ZIP (stored or deflated entries) — test fixtures only. */
export function writeZip(
  path: string,
  files: Record<string, Buffer | string>,
  options: { deflate?: boolean; lieAboutSize?: number } = {},
): void {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content, "utf8");
    const compressed = options.deflate ? deflateRawSync(data) : data;
    const method = options.deflate ? 8 : 0;
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(options.lieAboutSize ?? data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(0, 12);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(options.lieAboutSize ?? data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + compressed.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(path, Buffer.concat([...locals, ...central, end]));
}

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export function rels(
  entries: { id: string; type: string; target: string; external?: boolean }[],
): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries
    .map(
      (e) =>
        `<Relationship Id="${e.id}" Type="${REL}/${e.type}" Target="${e.target}"${e.external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("")}</Relationships>`;
}

export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export interface DeckSpec {
  cx?: number;
  cy?: number;
  title?: string;
  /** Slide bodies: the contents of <p:spTree> plus extra slide children. */
  slides: {
    tree: string;
    extra?: string;
    attrs?: string;
    rels?: { id: string; type: string; target: string; external?: boolean }[];
  }[];
  layoutTree?: string;
  masterTree?: string;
  masterBg?: string;
  masterRels?: { id: string; type: string; target: string }[];
  txStyles?: string;
  media?: Record<string, Buffer>;
}

export const THEME = `<?xml version="1.0"?><a:theme ${NS} name="T"><a:themeElements><a:clrScheme name="c">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F2A44"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
</a:clrScheme><a:fontScheme name="f"><a:majorFont><a:latin typeface="Montserrat"/></a:majorFont><a:minorFont><a:latin typeface="Open Sans"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

/** Assembles a minimal but valid .pptx package. */
export function buildPptx(path: string, spec: DeckSpec): void {
  const files: Record<string, Buffer | string> = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst>${spec.slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`)
      .join(
        "",
      )}</p:sldIdLst><p:sldSz cx="${spec.cx ?? 12192000}" cy="${spec.cy ?? 6858000}"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(
      spec.slides.map((_, i) => ({
        id: `rId${i + 10}`,
        type: "slide",
        target: `slides/slide${i + 1}.xml`,
      })),
    ),
    "ppt/slideLayouts/slideLayout1.xml": `<?xml version="1.0"?><p:sldLayout ${NS}><p:cSld><p:spTree>${spec.layoutTree ?? ""}</p:spTree></p:cSld></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([
      {
        id: "rId1",
        type: "slideMaster",
        target: "../slideMasters/slideMaster1.xml",
      },
    ]),
    "ppt/slideMasters/slideMaster1.xml": `<?xml version="1.0"?><p:sldMaster ${NS}><p:cSld>${spec.masterBg ?? ""}<p:spTree>${spec.masterTree ?? ""}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"/>${spec.txStyles ?? ""}</p:sldMaster>`,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([
      { id: "rId1", type: "theme", target: "../theme/theme1.xml" },
      ...(spec.masterRels ?? []),
    ]),
    "ppt/theme/theme1.xml": THEME,
  };
  if (spec.title) {
    files["docProps/core.xml"] =
      `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${spec.title}</dc:title></cp:coreProperties>`;
  }
  spec.slides.forEach((slide, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] =
      `<?xml version="1.0"?><p:sld ${NS} ${slide.attrs ?? ""}><p:cSld><p:spTree>${slide.tree}</p:spTree></p:cSld>${slide.extra ?? ""}</p:sld>`;
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([
      {
        id: "rIdL",
        type: "slideLayout",
        target: "../slideLayouts/slideLayout1.xml",
      },
      ...(slide.rels ?? []),
    ]);
  });
  for (const [name, bytes] of Object.entries(spec.media ?? {}))
    files[`ppt/media/${name}`] = bytes;
  writeZip(path, files);
}

export const xfrm = (x: number, y: number, w: number, h: number) =>
  `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;

/** A text box shape. */
export function textBox(
  id: number,
  frame: string,
  paragraphs: string,
  options: { anchor?: string; spPr?: string } = {},
): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="T${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${frame}<a:prstGeom prst="rect"/>${options.spPr ?? ""}</p:spPr><p:txBody><a:bodyPr${options.anchor ? ` anchor="${options.anchor}"` : ""}/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}
