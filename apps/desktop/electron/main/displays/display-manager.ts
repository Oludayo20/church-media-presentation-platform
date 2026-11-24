import type { DisplayInfo, DisplayStatus } from "@cmp/shared-types";
import { AppError } from "@cmp/shared-types";
import type { DisplayProfile, DisplayProfileRepository } from "@cmp/database";
import type { Logger } from "../logging/logger";
import {
  fingerprint,
  physicalSize,
  type DisplayLike,
  type ScreenSource,
} from "./screen-source";

export interface DisplayManagerEvents {
  /** Anything the operator's display list shows changed. */
  changed(status: DisplayStatus): void;
  /** The audience display disappeared (cable pulled, projector off). */
  audienceLost(): void;
  /** The audience display is available — newly assigned or plugged back in. */
  audienceAvailable(display: DisplayLike): void;
  /** The audience display changed resolution, scale or position. */
  audienceMoved(display: DisplayLike): void;
}

export interface DisplayManagerOptions {
  screen: ScreenSource;
  /** Null until a workspace exists. */
  profiles: () => DisplayProfileRepository | null;
  /** Output resolution recorded on new profiles. */
  outputResolution: () => Promise<{ w: number; h: number }>;
  events: DisplayManagerEvents;
  logger: Logger;
}

interface Assignment {
  profile: DisplayProfile;
  /** OS id while connected, null while unplugged. */
  displayId: number | null;
}

/**
 * Display detection, assignment and hot-plug (DOCUMENTATION.md §4):
 * - the operator assigns the audience display, remembered as a fingerprinted
 *   `display_profiles` row;
 * - on start-up, a connected display matching a remembered profile is
 *   re-assigned automatically;
 * - removing the audience display reports `audienceLost`; plugging the same
 *   display (by fingerprint) back in reports `audienceAvailable`;
 * - an unknown display triggers the "Use as audience screen?" prompt.
 */
export function createDisplayManager(options: DisplayManagerOptions) {
  const { screen, events, logger } = options;
  let assignment: Assignment | null = null;
  let newDisplayId: number | null = null;
  const knownFingerprints = new Set<string>();

  function connected(): DisplayLike[] {
    return screen.getAllDisplays();
  }

  function audienceDisplay(): DisplayLike | null {
    if (assignment?.displayId == null) return null;
    return (
      connected().find((display) => display.id === assignment!.displayId) ??
      null
    );
  }

  function labelFor(display: DisplayLike, index: number): string {
    if (display.label.trim()) return display.label;
    return display.internal ? "Built-in display" : `Display ${index + 1}`;
  }

  function status(): DisplayStatus {
    const primaryId = screen.getPrimaryDisplay().id;
    const displays: DisplayInfo[] = connected().map((display, index) => ({
      id: display.id,
      label: labelFor(display, index),
      ...physicalSize(display),
      scaleFactor: display.scaleFactor,
      primary: display.id === primaryId,
      internal: display.internal,
      assigned: display.id === assignment?.displayId,
      known: knownFingerprints.has(fingerprint(display)),
    }));
    return {
      displays,
      audience: assignment
        ? {
            displayId: assignment.displayId,
            name: assignment.profile.name,
            connected: assignment.displayId !== null,
            profileId: assignment.profile.id,
          }
        : null,
      newDisplayId,
    };
  }

  const notify = () => events.changed(status());

  async function rememberAndAssign(display: DisplayLike): Promise<void> {
    const repository = options.profiles();
    if (!repository) throw new AppError("NOT_FOUND", "No workspace is open");
    const resolution = await options.outputResolution();
    const index = connected().findIndex(
      (candidate) => candidate.id === display.id,
    );
    const profile = await repository.remember({
      fingerprint: fingerprint(display),
      name: labelFor(display, index),
      width: resolution.w,
      height: resolution.h,
    });
    knownFingerprints.add(profile.fingerprint);
    const previous = assignment?.displayId;
    assignment = { profile, displayId: display.id };
    if (newDisplayId === display.id) newDisplayId = null;
    logger.info(`[displays] audience → ${profile.name} (${display.id})`);
    if (previous !== display.id) events.audienceAvailable(display);
    notify();
  }

  async function refreshKnown(): Promise<DisplayProfile[]> {
    const profiles = (await options.profiles()?.list()) ?? [];
    knownFingerprints.clear();
    profiles.forEach((profile) => knownFingerprints.add(profile.fingerprint));
    return profiles;
  }

  screen.on("display-removed", (display) => {
    if (newDisplayId === display.id) newDisplayId = null;
    if (assignment && assignment.displayId === display.id) {
      assignment = { ...assignment, displayId: null };
      logger.warn(`[displays] audience display ${display.id} removed`);
      events.audienceLost();
    }
    notify();
  });

  screen.on("display-added", (display) => {
    const print = fingerprint(display);
    if (
      assignment &&
      assignment.displayId === null &&
      print === assignment.profile.fingerprint
    ) {
      assignment = { ...assignment, displayId: display.id };
      logger.info(`[displays] audience display back as ${display.id}`);
      events.audienceAvailable(display);
    } else if (!assignment && knownFingerprints.has(print)) {
      void rememberAndAssign(display).catch((error: unknown) =>
        logger.error("[displays] auto-assign failed", error),
      );
      return;
    } else if (
      display.id !== screen.getPrimaryDisplay().id &&
      display.id !== assignment?.displayId
    ) {
      newDisplayId = display.id;
    }
    notify();
  });

  screen.on("display-metrics-changed", (display) => {
    if (display.id === assignment?.displayId) events.audienceMoved(display);
    notify();
  });

  return {
    status,
    audienceDisplay,
    allDisplays: connected,

    get profileId(): string | null {
      return assignment?.profile.id ?? null;
    },

    /**
     * After a workspace opens: load remembered profiles and re-assign the
     * most recently used one that is connected (never the primary display,
     * which holds the operator UI).
     */
    async restore(): Promise<void> {
      const profiles = await refreshKnown();
      const primaryId = screen.getPrimaryDisplay().id;
      for (const profile of profiles) {
        const match = connected().find(
          (display) =>
            display.id !== primaryId &&
            fingerprint(display) === profile.fingerprint,
        );
        if (match) {
          assignment = { profile, displayId: match.id };
          logger.info(`[displays] restored audience → ${profile.name}`);
          events.audienceAvailable(match);
          break;
        }
      }
      notify();
    },

    async assign(displayId: number): Promise<DisplayStatus> {
      const display = connected().find(
        (candidate) => candidate.id === displayId,
      );
      if (!display)
        throw new AppError(
          "DISPLAY_UNAVAILABLE",
          "That display is not connected",
        );
      await rememberAndAssign(display);
      return status();
    },

    unassign(): DisplayStatus {
      if (assignment) {
        const wasConnected = assignment.displayId !== null;
        assignment = null;
        if (wasConnected) events.audienceLost();
      }
      notify();
      return status();
    },

    dismissNew(): DisplayStatus {
      newDisplayId = null;
      notify();
      return status();
    },
  };
}

export type DisplayManager = ReturnType<typeof createDisplayManager>;
