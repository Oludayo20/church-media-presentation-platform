import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rotateLogFiles } from "../rotate";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cmp-logs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("rotateLogFiles", () => {
  it("shifts files and keeps at most `keep` in total", () => {
    const main = join(dir, "main.log");
    for (let generation = 1; generation <= 7; generation += 1) {
      writeFileSync(main, `gen ${generation}`);
      rotateLogFiles(main, 5);
    }
    expect(readdirSync(dir).sort()).toEqual([
      "main.1.log",
      "main.2.log",
      "main.3.log",
      "main.4.log",
    ]);
    expect(readFileSync(join(dir, "main.1.log"), "utf8")).toBe("gen 7");
    expect(readFileSync(join(dir, "main.4.log"), "utf8")).toBe("gen 4");
  });
});
