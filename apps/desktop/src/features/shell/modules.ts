import {
  BookOpen,
  CalendarDays,
  Download,
  House,
  Image,
  LayoutTemplate,
  Music,
  Presentation,
  Radio,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface ModuleDefinition {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Where in docs/TASKS.md the module is built; omitted once it exists. */
  arrivesIn?: string;
}

/** The ten modules of the operator app (ARCHITECTURE.md §4.2). */
export const MODULES = [
  {
    id: "home",
    label: "Home",
    icon: House,
    description: "Your church at a glance.",
  },
  {
    id: "live",
    label: "Live",
    icon: Radio,
    description:
      "Run the service: current, next and audience previews with black, logo and clear always one key away.",
  },
  {
    id: "services",
    label: "Services",
    icon: CalendarDays,
    description:
      "Plan Sunday: songs, scripture, media and announcements in running order.",
    arrivesIn: "Phase 8",
  },
  {
    id: "presentations",
    label: "Presentations",
    icon: Presentation,
    description: "Build and edit slide decks, or import PowerPoint files.",
  },
  {
    id: "songs",
    label: "Songs",
    icon: Music,
    description: "Lyrics, arrangements and automatic slide generation.",
  },
  {
    id: "bible",
    label: "Bible",
    icon: BookOpen,
    description: "Translations, search and Quick Scripture.",
  },
  {
    id: "media",
    label: "Media",
    icon: Image,
    description: "Images, videos and motion backgrounds, stored offline.",
  },
  {
    id: "templates",
    label: "Templates",
    icon: LayoutTemplate,
    description: "Reusable looks for worship, scripture, sermons and more.",
    arrivesIn: "Phase 7",
  },
  {
    id: "downloads",
    label: "Downloads",
    icon: Download,
    description:
      "Media packs and community templates. The only module that needs the internet.",
    arrivesIn: "post-MVP",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    description: "Workspace, output and appearance.",
  },
] as const satisfies readonly ModuleDefinition[];

export type ModuleId = (typeof MODULES)[number]["id"];
