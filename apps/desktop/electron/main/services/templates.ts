import type { ServiceItemOptions, ServiceItemTypeName } from "@cmp/shared-types";

/** A template placeholder (§8.3): an item type, a label and default options. */
export interface TemplateItem {
  itemType: ServiceItemTypeName;
  label: string;
  options: ServiceItemOptions;
  group?: string;
}

export interface ServiceTemplateDefinition {
  serviceType: string;
  items: TemplateItem[];
}

export interface BuiltInServiceTemplate {
  id: string;
  name: string;
  description: string;
  definition: ServiceTemplateDefinition;
}

const countdown = (minutes: number, title = "Service starts in"): TemplateItem => ({
  itemType: "countdown",
  label: `Countdown (${minutes} min)`,
  options: { type: "countdown", durationMs: minutes * 60_000, title, backgroundAssetId: null, onComplete: "next_item", chime: true },
});
const song = (label: string, group?: string): TemplateItem => ({
  itemType: "song",
  label,
  options: { type: "song", templateId: null, backgroundAssetId: null },
  ...(group ? { group } : {}),
});
const scripture = (label: string, group?: string): TemplateItem => ({
  itemType: "scripture",
  label,
  options: { type: "scripture", translation: "KJV", reference: "", onePerSlide: false },
  ...(group ? { group } : {}),
});
const presentation = (label: string, group?: string): TemplateItem => ({
  itemType: "presentation",
  label,
  options: { type: "presentation" },
  ...(group ? { group } : {}),
});
const announcements: TemplateItem = {
  itemType: "announcement",
  label: "Announcements",
  options: { type: "announcement", durationMs: 8000, loop: true },
};
const logo = (label = "Closing (logo)"): TemplateItem => ({ itemType: "blank", label, options: { type: "blank", mode: "logo" } });

/** Built-in service templates (DOCUMENTATION.md §8.2). */
export const BUILT_IN_SERVICE_TEMPLATES: readonly BuiltInServiceTemplate[] = [
  {
    id: "builtin:sunday",
    name: "Sunday service",
    description: "Countdown, praise & worship, scripture, sermon, announcements, closing song",
    definition: {
      serviceType: "sunday",
      items: [
        countdown(10),
        song("Opening song", "Praise & Worship"),
        song("Praise song", "Praise & Worship"),
        song("Worship song", "Praise & Worship"),
        scripture("Scripture reading", "The Word"),
        presentation("Sermon slides", "The Word"),
        announcements,
        song("Closing song"),
        logo(),
      ],
    },
  },
  {
    id: "builtin:bible-study",
    name: "Bible study",
    description: "Opening song, scripture passages, study notes, closing prayer",
    definition: {
      serviceType: "bible_study",
      items: [song("Opening song"), scripture("Main passage"), scripture("Supporting passage"), presentation("Study notes"), logo("Closing prayer")],
    },
  },
  {
    id: "builtin:prayer",
    name: "Prayer meeting",
    description: "Worship, prayer points, scripture",
    definition: {
      serviceType: "prayer",
      items: [song("Worship song"), presentation("Prayer points"), scripture("Scripture"), song("Closing song"), logo()],
    },
  },
  {
    id: "builtin:communion",
    name: "Communion service",
    description: "Worship, communion scripture, communion song",
    definition: {
      serviceType: "communion",
      items: [countdown(5), song("Worship song"), scripture("Communion reading"), song("Communion song"), logo()],
    },
  },
  {
    id: "builtin:wedding",
    name: "Wedding",
    description: "Processional, hymns, readings, vows, recessional",
    definition: {
      serviceType: "wedding",
      items: [countdown(15, "The ceremony begins in"), song("Processional hymn"), scripture("Reading"), presentation("Vows & order"), song("Recessional"), logo()],
    },
  },
  {
    id: "builtin:funeral",
    name: "Funeral / thanksgiving",
    description: "Hymns, readings, tribute slides",
    definition: {
      serviceType: "funeral",
      items: [song("Opening hymn"), scripture("Reading"), presentation("Tribute"), song("Closing hymn"), logo()],
    },
  },
  {
    id: "builtin:conference",
    name: "Conference",
    description: "Countdown, worship, speaker slides, announcements",
    definition: {
      serviceType: "conference",
      items: [countdown(10), song("Worship song", "Worship"), song("Worship song", "Worship"), presentation("Speaker slides"), announcements, logo()],
    },
  },
  {
    id: "builtin:youth",
    name: "Youth service",
    description: "Countdown, praise, message, announcements",
    definition: {
      serviceType: "youth",
      items: [countdown(5), song("Praise song"), song("Praise song"), presentation("Message"), announcements, logo()],
    },
  },
];
