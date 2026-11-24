/**
 * Built-in lyric layouts until the Phase 7 template system. Coordinates are
 * in the 1920×1080 song document.
 */
export interface SongTemplate {
  id: string;
  name: string;
  box: { x: number; y: number; w: number; h: number };
  fontFamily: string;
  fontSize: number;
  minFontSize: number;
  fontWeight: number;
  lineHeight: number;
  align: "left" | "center" | "right";
  vAlign: "top" | "middle" | "bottom";
  color: string;
  shadow: string;
  uppercase: boolean;
}

const FONT = "Inter, 'Segoe UI', system-ui, sans-serif";

export const SONG_TEMPLATES: readonly SongTemplate[] = [
  {
    id: "classic",
    name: "Classic (centred)",
    box: { x: 160, y: 150, w: 1600, h: 760 },
    fontFamily: FONT,
    fontSize: 88,
    minFontSize: 48,
    fontWeight: 700,
    lineHeight: 1.25,
    align: "center",
    vAlign: "middle",
    color: "#ffffff",
    shadow: "0 4px 18px #000c",
    uppercase: false,
  },
  {
    id: "lower-third",
    name: "Lower third (over video)",
    box: { x: 120, y: 690, w: 1680, h: 300 },
    fontFamily: FONT,
    fontSize: 64,
    minFontSize: 36,
    fontWeight: 700,
    lineHeight: 1.2,
    align: "center",
    vAlign: "bottom",
    color: "#ffffff",
    shadow: "0 3px 10px #000",
    uppercase: false,
  },
  {
    id: "bold",
    name: "Bold capitals",
    box: { x: 140, y: 140, w: 1640, h: 780 },
    fontFamily: FONT,
    fontSize: 96,
    minFontSize: 52,
    fontWeight: 800,
    lineHeight: 1.15,
    align: "center",
    vAlign: "middle",
    color: "#ffffff",
    shadow: "0 4px 24px #000",
    uppercase: true,
  },
];

export function songTemplate(id: string | null | undefined): SongTemplate {
  return (
    SONG_TEMPLATES.find((template) => template.id === id) ?? SONG_TEMPLATES[0]!
  );
}
