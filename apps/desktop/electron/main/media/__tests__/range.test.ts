import { describe, expect, it } from "vitest";
import { parseRange } from "../range";

describe("parseRange", () => {
  const size = 1000;
  it.each([
    [null, { kind: "full" }],
    ["bytes=0-99", { kind: "partial", range: { start: 0, end: 99 } }],
    ["bytes=500-", { kind: "partial", range: { start: 500, end: 999 } }],
    ["bytes=-100", { kind: "partial", range: { start: 900, end: 999 } }],
    ["bytes=-5000", { kind: "partial", range: { start: 0, end: 999 } }],
    ["bytes=900-5000", { kind: "partial", range: { start: 900, end: 999 } }],
    ["bytes=1000-", { kind: "unsatisfiable" }],
    ["bytes=-0", { kind: "unsatisfiable" }],
    ["bytes=50-10", { kind: "full" }],
    ["bytes=0-1,5-9", { kind: "full" }],
    ["items=0-1", { kind: "full" }],
    ["bytes=-", { kind: "full" }],
  ] as const)("%s", (header, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });

  it("any range on an empty file is unsatisfiable", () => {
    expect(parseRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });
});
