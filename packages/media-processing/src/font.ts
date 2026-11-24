/**
 * Reads a TrueType/OpenType font's family name from its `name` table, so an
 * imported font can be registered with `FontFace` under the name designers
 * know (docs/TASKS.md Phase 7). Prefers the typographic family (nameID 16),
 * then the family (nameID 1); Windows Unicode records (English first), then
 * Macintosh Roman. Returns null for anything that is not a readable font.
 */
export function fontFamilyName(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12) return null;
  const version = view.getUint32(0);
  if (
    version !== 0x00010000 &&
    version !== 0x4f54544f /* OTTO */ &&
    version !== 0x74727565 /* true */
  )
    return null;
  const tables = view.getUint16(4);
  let nameOffset = -1;
  for (let index = 0; index < tables; index += 1) {
    const record = 12 + index * 16;
    if (record + 16 > bytes.length) return null;
    if (String.fromCharCode(...bytes.subarray(record, record + 4)) === "name") {
      nameOffset = view.getUint32(record + 8);
      break;
    }
  }
  if (nameOffset < 0 || nameOffset + 6 > bytes.length) return null;
  const count = view.getUint16(nameOffset + 2);
  const storage = nameOffset + view.getUint16(nameOffset + 4);

  const candidates: { score: number; value: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const record = nameOffset + 6 + index * 12;
    if (record + 12 > bytes.length) break;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const language = view.getUint16(record + 4);
    const nameId = view.getUint16(record + 6);
    const length = view.getUint16(record + 8);
    const start = storage + view.getUint16(record + 10);
    if ((nameId !== 16 && nameId !== 1) || start + length > bytes.length)
      continue;
    const raw = bytes.subarray(start, start + length);
    let value: string | null = null;
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      value = new TextDecoder("utf-16be").decode(raw);
    } else if (platform === 0) {
      value = new TextDecoder("utf-16be").decode(raw);
    } else if (platform === 1 && encoding === 0) {
      value = new TextDecoder("latin1").decode(raw);
    }
    if (!value?.trim()) continue;
    const score =
      (nameId === 16 ? 100 : 0) +
      (platform === 3 ? 10 : platform === 0 ? 5 : 0) +
      (language === 0x409 || language === 0 ? 1 : 0);
    candidates.push({
      score,
      value: value
        .replace(/[\p{Cc}"\\]/gu, "")
        .trim()
        .slice(0, 100),
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value || null;
}
