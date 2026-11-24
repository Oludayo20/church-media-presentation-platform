import { describe, expect, it } from "vitest";
import { fontFamilyName } from "../font";

/** Builds a minimal sfnt with only a `name` table. */
export function fakeFont(
  records: {
    platform: number;
    encoding: number;
    language: number;
    nameId: number;
    value: string;
  }[],
  version = 0x00010000,
): Uint8Array {
  const encoded = records.map((record) =>
    record.platform === 1
      ? Buffer.from(record.value, "latin1")
      : Buffer.from(record.value, "utf16le").swap16(),
  );
  const nameHeader = 6 + records.length * 12;
  const strings = Buffer.concat(encoded);
  const name = Buffer.alloc(nameHeader + strings.length);
  name.writeUInt16BE(0, 0);
  name.writeUInt16BE(records.length, 2);
  name.writeUInt16BE(nameHeader, 4);
  let offset = 0;
  records.forEach((record, index) => {
    const at = 6 + index * 12;
    name.writeUInt16BE(record.platform, at);
    name.writeUInt16BE(record.encoding, at + 2);
    name.writeUInt16BE(record.language, at + 4);
    name.writeUInt16BE(record.nameId, at + 6);
    name.writeUInt16BE(encoded[index]!.length, at + 8);
    name.writeUInt16BE(offset, at + 10);
    offset += encoded[index]!.length;
  });
  strings.copy(name, nameHeader);
  const header = Buffer.alloc(12 + 16);
  header.writeUInt32BE(version, 0);
  header.writeUInt16BE(1, 4);
  header.write("name", 12, "latin1");
  header.writeUInt32BE(28, 20);
  header.writeUInt32BE(name.length, 24);
  return new Uint8Array(Buffer.concat([header, name]));
}

describe("fontFamilyName", () => {
  it("prefers the typographic family in a Windows English record", () => {
    const font = fakeFont([
      { platform: 1, encoding: 0, language: 0, nameId: 1, value: "Mac Family" },
      {
        platform: 3,
        encoding: 1,
        language: 0x409,
        nameId: 1,
        value: "Montserrat SemiBold",
      },
      {
        platform: 3,
        encoding: 1,
        language: 0x409,
        nameId: 16,
        value: "Montserrat",
      },
    ]);
    expect(fontFamilyName(font)).toBe("Montserrat");
  });

  it("falls back to the family name and handles OpenType (OTTO) and non-Latin names", () => {
    expect(
      fontFamilyName(
        fakeFont(
          [
            {
              platform: 3,
              encoding: 1,
              language: 0x409,
              nameId: 1,
              value: "Ọ̀rọ̀ Sans",
            },
          ],
          0x4f54544f,
        ),
      ),
    ).toBe("Ọ̀rọ̀ Sans");
    expect(
      fontFamilyName(
        fakeFont([
          {
            platform: 1,
            encoding: 0,
            language: 0,
            nameId: 1,
            value: "Old Mac",
          },
        ]),
      ),
    ).toBe("Old Mac");
  });

  it("strips quotes and control characters that could break CSS", () => {
    expect(
      fontFamilyName(
        fakeFont([
          {
            platform: 3,
            encoding: 1,
            language: 0x409,
            nameId: 1,
            value: 'Evil"\\ Font\u0001',
          },
        ]),
      ),
    ).toBe("Evil Font");
  });

  it("returns null for non-fonts and truncated files", () => {
    expect(fontFamilyName(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(
      fontFamilyName(
        fakeFont([
          { platform: 3, encoding: 1, language: 0x409, nameId: 1, value: "X" },
        ]).subarray(0, 30),
      ),
    ).toBeNull();
    expect(
      fontFamilyName(
        fakeFont([
          {
            platform: 3,
            encoding: 1,
            language: 0x409,
            nameId: 4,
            value: "Full only",
          },
        ]),
      ),
    ).toBeNull();
  });
});
