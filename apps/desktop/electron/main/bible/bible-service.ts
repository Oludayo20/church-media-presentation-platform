import {
  generateScriptureDocument,
  matchBibleBook,
  selectBibleVerses,
} from "@cmp/import-export";
import { AppError } from "@cmp/shared-types";
import type { WorkspaceManager } from "../workspace/workspace-manager";
import type { JobRunner } from "../jobs/job-runner";
import type { LiveSessionController } from "../live/live-session";

interface BibleServiceOptions {
  workspaces: WorkspaceManager;
  jobs: JobRunner;
  choosePackage(): Promise<string | null>;
  live: LiveSessionController;
}

export function createBibleService({
  workspaces,
  jobs,
  choosePackage,
  live,
}: BibleServiceOptions) {
  async function passage(code: string, reference: string, onePerSlide?: boolean) {
    const { bible, settings } = workspaces.require();
    const match = matchBibleBook(reference, await bible.books(code));
    const verses =
      match &&
      selectBibleVerses(match.address, await bible.verses(match.book.id));
    if (!match || !verses) return null;
    const title = `${match.book.name} ${match.address.trim().replace(/^(\d+) (\d+)/u, "$1:$2")}`;
    const result = generateScriptureDocument(
      title,
      code,
      verses.map(({ verse, text }) => `${verse}  ${text}`),
      onePerSlide || (await settings.get("bible.onePerSlide")),
    );
    if (!result.success) throw new AppError("VALIDATION_ERROR", result.error);
    return result.doc;
  }

  async function requirePassage(code: string, reference: string, onePerSlide?: boolean) {
    const doc = await passage(code, reference, onePerSlide);
    if (!doc)
      throw new AppError(
        "NOT_FOUND",
        "That passage is unavailable in this translation",
      );
    return doc;
  }

  return {
    async install() {
      const workspace = workspaces.require();
      if (live.active)
        throw new AppError(
          "CONFLICT",
          "End the live session before installing a translation",
        );
      const path = await choosePackage();
      if (!path) return null;
      let result;
      try {
        result = await jobs.start({ kind: "bible", path }, () => {}).done;
      } catch (error) {
        throw new AppError(
          "VALIDATION_ERROR",
          error instanceof Error
            ? error.message
            : "Could not read the Bible package",
        );
      }
      if (!result.bible) return null;
      if (live.active || workspaces.current() !== workspace)
        throw new AppError(
          "CONFLICT",
          "The workspace is busy. Try installing the translation again",
        );
      return workspace.bible.install(
        result.bible.translation,
        result.bible.verses,
      );
    },
    async search(code: string, query: string) {
      const bible = workspaces.require().bible;
      const match = matchBibleBook(query, await bible.books(code));
      const verses =
        match &&
        selectBibleVerses(match.address, await bible.verses(match.book.id));
      return {
        reference: match && verses ? query : null,
        matches: bible
          .search(code, query)
          .map(({ book, chapter, verse, snippet }) => ({
            reference: `${book} ${chapter}:${verse}`,
            snippet,
          })),
      };
    },
    requirePassage,
    async show(code: string, reference: string, sessionId: string) {
      const doc = await requirePassage(code, reference);
      if (live.state().sessionId !== sessionId)
        throw new AppError("CONFLICT", "The live session changed");
      return live.overlayPushDocument({
        id: doc.id,
        kind: "scripture",
        title: doc.title,
        doc,
      });
    },
    async queue(code: string, reference: string, sessionId: string) {
      const doc = await requirePassage(code, reference);
      if (live.state().sessionId !== sessionId)
        throw new AppError("CONFLICT", "The live session changed");
      return live.appendItem({
        id: doc.id,
        kind: "scripture",
        title: doc.title,
        doc,
      });
    },
  };
}

export type BibleService = ReturnType<typeof createBibleService>;
