import {
  ENGINE_DOCUMENT_SCHEMA_VERSION,
  engineDocumentSchema,
} from "@cmp/shared-validation";

const designs = [
  { name: "Worship", stops: ["#161329", "#50406b"], subtitle: "Song title" },
  { name: "Praise", stops: ["#3f125d", "#b53346"], subtitle: "Song title" },
  {
    name: "Scripture",
    stops: ["#11243c", "#344d61"],
    subtitle: "Book · Chapter · Verse",
  },
  { name: "Sermon", stops: ["#181e2e", "#394151"], subtitle: "Speaker name" },
  { name: "Announcements", stops: ["#12382e", "#1d7059"], subtitle: "Details" },
  {
    name: "Offering",
    stops: ["#302714", "#775227"],
    subtitle: "Giving details",
  },
  {
    name: "Countdown",
    stops: ["#102044", "#283f85"],
    subtitle: "Service begins shortly",
  },
  {
    name: "Events",
    stops: ["#401c2c", "#7a3343"],
    subtitle: "Date · Time · Location",
  },
  {
    name: "Closing",
    stops: ["#1a2031", "#383556"],
    subtitle: "Thank you for joining us",
  },
];

export const builtInTemplates = designs.map(({ name, stops, subtitle }) => {
  const id = `builtin:${name.toLowerCase()}`;
  return {
    id,
    name,
    doc: engineDocumentSchema.parse({
      schemaVersion: ENGINE_DOCUMENT_SCHEMA_VERSION,
      id,
      title: name,
      width: 1920,
      height: 1080,
      slides: [
        {
          id: "title",
          background: { type: "gradient", angle: 145, stops },
          objects: [
            {
              id: "title",
              type: "text",
              frame: { x: 160, y: 330, w: 1600, h: 250 },
              content: name,
              style: { fontSize: 108, fontWeight: 700 },
            },
            {
              id: "subtitle",
              type: "text",
              frame: { x: 160, y: 600, w: 1600, h: 130 },
              content: subtitle,
              style: { fontSize: 50, fontWeight: 400 },
            },
          ],
        },
      ],
    }),
  };
});
