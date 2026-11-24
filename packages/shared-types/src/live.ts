/** Displays as the operator sees them (`displays:*`, DOCUMENTATION.md §4). */
export interface DisplayInfo {
  id: number;
  label: string;
  /** Physical pixels (bounds × scaleFactor). */
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
  internal: boolean;
  /** The current audience display. */
  assigned: boolean;
  /** A remembered display profile matches this display. */
  known: boolean;
}

export interface DisplayStatus {
  displays: DisplayInfo[];
  /** The assigned audience display, connected or not. */
  audience: {
    displayId: number | null;
    name: string;
    connected: boolean;
    profileId: string;
  } | null;
  /** An unknown display was just plugged in: offer it as the audience screen. */
  newDisplayId: number | null;
}

export type LiveStatus =
  "idle" | "preparing" | "live" | "masked" | "overlay" | "suspended";

export type LiveOutput = "display" | "preview" | "disconnected";

export type PlaylistItemKind =
  | "announcement"
  | "song"
  | "scripture"
  | "media"
  | "presentation"
  | "countdown"
  | "blank";

export interface LivePlaylistItem {
  id: string;
  title: string;
  kind: PlaylistItemKind;
  slideCount: number;
  /** Bumped when the item's document changes (live edits). */
  revision: number;
  /** For song items: the song to edit. */
  songId: string | null;
}

/** Pushed as `live:state` on every change (DOCUMENTATION.md §11). */
export interface LiveState {
  status: LiveStatus;
  sessionId: string | null;
  output: LiveOutput;
  mask: "none" | "black" | "logo";
  cleared: boolean;
  testPattern: boolean;
  itemIndex: number;
  slideIndex: number;
  items: LivePlaylistItem[];
  overlay: {
    depth: number;
    kind: PlaylistItemKind;
    title: string;
    itemIndex: number;
    slideIndex: number;
    slideCount: number;
  } | null;
  video: {
    timeMs: number;
    durationMs: number | null;
    paused: boolean;
    muted: boolean;
    volume: number;
  } | null;
  warnings: { code: string; message: string }[];
  /** The service being run, if the session was started from one. */
  service: { id: string; title: string } | null;
  /** A running countdown (§8.4): wall-clock end time and its item. */
  timer: { endsAt: number; itemIndex: number } | null;
  /** Announcement auto-rotation on the current item (§8.4). */
  rotation: { durationMs: number; paused: boolean } | null;
}
