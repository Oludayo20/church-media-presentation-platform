/// <reference types="vite/client" />
import type { CmpApi } from "@cmp/shared-validation";

declare global {
  interface Window {
    readonly cmp: CmpApi & {
      /** Path of a dropped file (Electron `webUtils.getPathForFile`). */
      readonly files: { pathFor(file: File): string };
    };
  }
}
