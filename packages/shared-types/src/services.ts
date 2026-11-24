export type ServiceItemTypeName =
  | "presentation"
  | "song"
  | "scripture"
  | "video"
  | "image"
  | "countdown"
  | "announcement"
  | "blank"
  | "camera_placeholder";

export type ServiceItemOptions =
  | { type: "presentation" }
  | { type: "song"; templateId: string | null; backgroundAssetId: string | null }
  | { type: "scripture"; translation: string; reference: string; onePerSlide: boolean }
  | { type: "video"; loop: boolean; muted: boolean }
  | { type: "image" }
  | {
      type: "countdown";
      durationMs: number;
      title: string;
      backgroundAssetId: string | null;
      onComplete: "next_item" | "hold" | "logo";
      chime: boolean;
    }
  | { type: "announcement"; durationMs: number; loop: boolean }
  | { type: "blank"; mode: "black" | "logo" }
  | { type: "camera_placeholder" };

export interface ServiceItemData {
  id: string;
  groupId: string | null;
  itemType: ServiceItemTypeName;
  /** Presentation, song or media id; null for placeholders and self-contained items. */
  refId: string | null;
  options: ServiceItemOptions;
  /** Placeholder name from a template ("Opening song"), or a custom title. */
  label: string | null;
  notes: string | null;
}

export interface ServiceData {
  title: string;
  serviceType: string | null;
  /** `YYYY-MM-DD`. */
  serviceDate: string | null;
  /** `HH:MM`. */
  startTime: string | null;
  theme: string | null;
  description: string | null;
  groups: { id: string; name: string }[];
  items: ServiceItemData[];
}

export interface ServiceDetail extends ServiceData {
  id: string;
  status: "draft" | "ready" | "live" | "completed" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface ServiceListItem {
  id: string;
  title: string;
  serviceType: string | null;
  serviceDate: string | null;
  startTime: string | null;
  status: string;
  itemCount: number;
  updatedAt: string;
}

/** One item of the full-programme preview. */
export interface ServicePreviewItem {
  itemId: string;
  title: string;
  /** Why the item cannot be shown (missing reference, empty placeholder…). */
  problem: string | null;
  slideCount: number;
}
