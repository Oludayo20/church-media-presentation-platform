/// <reference types="vite/client" />
import type { CmpApi } from "@cmp/shared-types";

declare global {
  interface Window {
    readonly cmp: CmpApi;
  }
}
