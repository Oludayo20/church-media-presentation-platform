import {
  ENGINE_DOCUMENT_SCHEMA_VERSION,
  engineDocumentSchema,
  type Background,
  type EngineDocumentInput,
} from "@cmp/shared-validation";
import type { MediaAsset } from "@cmp/database";
import type { PlaylistItem } from "./live-session";

/**
 * The Phase 2–3 test deck ("load a hard-coded deck", docs/TASKS.md). Real
 * services, songs and scripture arrive in Phases 5–8 and will resolve into
 * the same `PlaylistItem`s (DOCUMENTATION.md §3.2). All text here is
 * placeholder written for the demo, so no licence questions arise.
 *
 * Imported test media (category `test-deck`) is appended so a real 1080p
 * video can be checked on real hardware.
 */
export interface DemoPlaylistInput {
  churchName: string;
  logoSrc: string | null;
  testMedia: MediaAsset[];
}

const W = 1920;
const H = 1080;
const LYRIC_FRAME = { x: 160, y: 200, w: 1600, h: 680 };
const FOOTER_FRAME = { x: 160, y: 930, w: 1600, h: 80 };
const SHADOW = "0 4px 18px #000c";

const WORSHIP_BG: Background = {
  type: "gradient",
  angle: 160,
  stops: ["#1b1f3b", "#3d2c6b", "#0e1116"],
};
const SCRIPTURE_BG: Background = {
  type: "gradient",
  angle: 180,
  stops: ["#0f2027", "#203a43", "#2c5364"],
};

const MORNING_SONG = [
  "Morning song, line 1\nMorning song, line 2",
  "Morning song, line 3\nMorning song, line 4",
  "Morning song, line 5\nMorning song, line 6",
  "Morning song, line 7\nMorning song, line 8",
  "Morning song, line 9\nMorning song, line 10",
  "Morning song, line 11\nMorning song, line 12",
  "Morning song, line 13\nMorning song, line 14",
  "Morning song, line 15\nMorning song, line 16",
];

const EVENING_HYMN = [
  "Evening hymn, line 1\nEvening hymn, line 2",
  "Evening hymn, line 3\nEvening hymn, line 4",
  "Evening hymn, line 5\nEvening hymn, line 6",
  "Evening hymn, line 7\nEvening hymn, line 8",
];

const SAMPLE_READING = [
  "Sample reading, verse 1.",
  "Sample reading, verse 2.",
  "Sample reading, verse 3.",
  "Sample reading, verse 4.",
  "Sample reading, verse 5.",
  "Sample reading, verse 6.",
];

export function buildDemoPlaylist(input: DemoPlaylistInput): PlaylistItem[] {
  const motion = input.testMedia.find((asset) => asset.mediaType === "video");
  const songBackground: Background = motion
    ? {
        type: "video",
        src: assetUrl(motion.id),
        loop: true,
        muted: true,
        fit: "cover",
      }
    : WORSHIP_BG;

  const items: PlaylistItem[] = [
    item("welcome", "Welcome", "announcement", [
      {
        id: "welcome-1",
        background: WORSHIP_BG,
        objects: [
          ...(input.logoSrc
            ? [
                {
                  id: "logo",
                  type: "image" as const,
                  frame: { x: 810, y: 180, w: 300, h: 300 },
                  src: input.logoSrc,
                },
              ]
            : []),
          text(
            "title",
            `Welcome to ${input.churchName}`,
            { x: 160, y: 520, w: 1600, h: 200 },
            96,
          ),
          text(
            "subtitle",
            "We are glad you are here",
            { x: 160, y: 720, w: 1600, h: 100 },
            48,
            400,
          ),
        ],
      },
    ]),
    song(
      "morning-song",
      "Morning Song",
      "Sample lyrics · Church Media demo",
      MORNING_SONG,
      songBackground,
    ),
    scripture(
      "sample-reading",
      "Sample Reading",
      SAMPLE_READING,
      "Reading 1",
      "DEMO",
    ),
    song(
      "evening-hymn",
      "Evening Hymn",
      "Sample lyrics · Church Media demo",
      EVENING_HYMN,
      songBackground,
    ),
    mediaItem(input.testMedia),
    item("announcements", "Announcements", "announcement", [
      {
        id: "notice-1",
        background: { type: "color", value: "#12263a" },
        objects: [
          text(
            "h",
            "Midweek Bible Study",
            { x: 160, y: 300, w: 1600, h: 160 },
            88,
          ),
          text(
            "b",
            "Wednesdays · 6:00 pm · Main hall",
            { x: 160, y: 520, w: 1600, h: 120 },
            56,
            400,
          ),
        ],
      },
      {
        id: "notice-2",
        background: { type: "color", value: "#2b1a12" },
        objects: [
          text(
            "h",
            "Thank you for worshipping with us",
            { x: 160, y: 380, w: 1600, h: 300 },
            80,
          ),
        ],
      },
    ]),
  ];
  return items;
}

function item(
  id: string,
  title: string,
  kind: PlaylistItem["kind"],
  slides: EngineDocumentInput["slides"],
): PlaylistItem {
  const doc = engineDocumentSchema.parse({
    schemaVersion: ENGINE_DOCUMENT_SCHEMA_VERSION,
    id,
    title,
    width: W,
    height: H,
    slides,
  } satisfies EngineDocumentInput);
  return { id, title, kind, doc };
}

function song(
  id: string,
  title: string,
  credit: string,
  stanzas: string[],
  background: Background,
): PlaylistItem {
  const slides: EngineDocumentInput["slides"] = [
    {
      id: `${id}-title`,
      background,
      objects: [
        text("title", title, { x: 160, y: 380, w: 1600, h: 200 }, 110),
        text("credit", credit, { x: 160, y: 600, w: 1600, h: 80 }, 40, 400),
      ],
    },
    ...stanzas.map((lines, index) => ({
      id: `${id}-${index + 1}`,
      background,
      objects: [text("lyric", lines, LYRIC_FRAME, 80)],
    })),
  ];
  // The last lyric slide carries the copyright footer (DOCUMENTATION.md §13).
  slides.at(-1)!.objects!.push(footer(credit));
  return item(id, title, "song", slides);
}

function scripture(
  id: string,
  title: string,
  verses: string[],
  book: string,
  translation: string,
): PlaylistItem {
  return item(
    id,
    title,
    "scripture",
    verses.map((verse, index) => ({
      id: `${id}-${index + 1}`,
      background: SCRIPTURE_BG,
      objects: [
        text("verse", verse, LYRIC_FRAME, 72, 500),
        footer(`${book}:${index + 1} ${translation}`),
      ],
    })),
  );
}

function mediaItem(testMedia: MediaAsset[]): PlaylistItem {
  if (testMedia.length === 0) {
    return item("test-media", "Test media", "media", [
      {
        id: "test-media-empty",
        background: { type: "color", value: "#000000" },
        objects: [
          text(
            "hint",
            "Add an image or a 1080p video with “Add test media” to check playback on the projector.",
            { x: 260, y: 400, w: 1400, h: 280 },
            56,
            500,
          ),
        ],
      },
    ]);
  }
  return item(
    "test-media",
    "Test media",
    "media",
    testMedia.map((asset) =>
      asset.mediaType === "video"
        ? {
            id: `media-${asset.id}`,
            background: { type: "color" as const, value: "#000000" },
            objects: [
              {
                id: "video",
                type: "video" as const,
                frame: { x: 0, y: 0, w: W, h: H },
                src: assetUrl(asset.id),
                loop: true,
                muted: false,
              },
            ],
          }
        : {
            id: `media-${asset.id}`,
            background: {
              type: "image" as const,
              src: assetUrl(asset.id),
              fit: "contain" as const,
            },
            objects: [],
          },
    ),
  );
}

function text(
  id: string,
  content: string,
  frame: { x: number; y: number; w: number; h: number },
  fontSize: number,
  fontWeight = 700,
) {
  return {
    id,
    type: "text" as const,
    frame,
    content,
    style: { fontSize, fontWeight, shadow: SHADOW },
  };
}

function footer(content: string) {
  return {
    id: "footer",
    type: "text" as const,
    frame: FOOTER_FRAME,
    content,
    role: "footer" as const,
    style: { fontSize: 32, fontWeight: 500, color: "#d0d4dc", autoFit: false },
  };
}

export function assetUrl(assetId: string): string {
  return `cmp-media://asset/${assetId}`;
}
