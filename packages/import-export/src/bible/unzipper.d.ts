declare module "unzipper/lib/Open/directory.js" {
  import type { Readable } from "node:stream";
  export default function openDirectory(
    source: {
      size(): Promise<number>;
      stream(offset: number, length?: number): Readable;
    },
    options: { tailSize: number },
  ): Promise<{
    files: {
      path: string;
      type: string;
      uncompressedSize: number;
      stream(): Readable;
    }[];
  }>;
}
