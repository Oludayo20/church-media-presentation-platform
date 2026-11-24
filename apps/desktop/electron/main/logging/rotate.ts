import { existsSync, renameSync, rmSync } from "node:fs";

/**
 * Rotates `main.log` → `main.1.log` → … → `main.<keep-1>.log`, dropping the
 * oldest, so at most `keep` files exist (DOCUMENTATION.md §13: 5 × 5 MB).
 */
export function rotateLogFiles(path: string, keep: number): void {
  const numbered = (index: number) => path.replace(/(\.log)?$/, `.${index}$1`);
  const oldest = numbered(keep - 1);
  if (existsSync(oldest)) rmSync(oldest, { force: true });
  for (let index = keep - 2; index >= 1; index -= 1) {
    if (existsSync(numbered(index))) {
      renameSync(numbered(index), numbered(index + 1));
    }
  }
  if (existsSync(path)) renameSync(path, numbered(1));
}
