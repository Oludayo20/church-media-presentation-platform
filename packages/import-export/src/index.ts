/**
 * @cmp/import-export — song, PPTX/PDF and Bible importers, exports and the
 * `.cmpbackup` workspace backup format.
 *
 * Songs (Phase 5), Bible packages (Phase 6) and PowerPoint import (Phase 7).
 * The parsers that read files (zip, PPTX, Bible packages) use Node built-ins
 * and run in the utility worker; the song generator is pure and also runs in
 * the main process. Never import this package from a renderer.
 */
export * from "./songs";
export { matchBibleBook, selectBibleVerses } from "./bible/reference";
export { generateScriptureDocument } from "./bible/slides";
export { MAX_BIBLE_PACKAGE_BYTES, readBiblePackage } from "./bible/package";
export * from "./pptx";
export { openZipFile, type ZipArchive, type ZipLimits } from "./zip";
