export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

export type RangeResult =
  | { kind: "full" }
  | { kind: "partial"; range: ByteRange }
  | { kind: "unsatisfiable" };

/**
 * Parses a single-range `Range: bytes=…` header (RFC 9110 §14) so `<video>`
 * can seek. Multi-range and malformed headers are ignored (full response),
 * as the RFC allows.
 */
export function parseRange(header: string | null, size: number): RangeResult {
  if (!header) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "full" };
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return { kind: "full" };

  if (first === "") {
    // Suffix range: the last N bytes.
    const length = Number(last);
    if (length === 0 || size === 0) return { kind: "unsatisfiable" };
    return {
      kind: "partial",
      range: { start: Math.max(0, size - length), end: size - 1 },
    };
  }

  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (last !== "" && Number(last) < start) return { kind: "full" };
  if (start >= size) return { kind: "unsatisfiable" };
  return { kind: "partial", range: { start, end } };
}
