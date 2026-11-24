import { z } from "zod";
import type { DisplayStatus, LiveState } from "@cmp/shared-types";
import { VIDEO_ACTIONS } from "../engine-protocol";

const displayInfoSchema = z.object({
  id: z.number(),
  label: z.string(),
  width: z.number(),
  height: z.number(),
  scaleFactor: z.number(),
  primary: z.boolean(),
  internal: z.boolean(),
  assigned: z.boolean(),
  known: z.boolean(),
});

export const displayStatusSchema = z.object({
  displays: z.array(displayInfoSchema),
  audience: z
    .object({
      displayId: z.number().nullable(),
      name: z.string(),
      connected: z.boolean(),
      profileId: z.string(),
    })
    .nullable(),
  newDisplayId: z.number().nullable(),
}) satisfies z.ZodType<DisplayStatus>;

const itemKind = z.enum([
  "announcement",
  "song",
  "scripture",
  "media",
  "presentation",
  "countdown",
  "blank",
]);

export const liveStateSchema = z.object({
  status: z.enum([
    "idle",
    "preparing",
    "live",
    "masked",
    "overlay",
    "suspended",
  ]),
  sessionId: z.string().nullable(),
  output: z.enum(["display", "preview", "disconnected"]),
  mask: z.enum(["none", "black", "logo"]),
  cleared: z.boolean(),
  testPattern: z.boolean(),
  itemIndex: z.int(),
  slideIndex: z.int(),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: itemKind,
      slideCount: z.int(),
      revision: z.int(),
      songId: z.string().nullable(),
    }),
  ),
  overlay: z
    .object({
      depth: z.int(),
      kind: itemKind,
      title: z.string(),
      itemIndex: z.int(),
      slideIndex: z.int(),
      slideCount: z.int(),
    })
    .nullable(),
  video: z
    .object({
      timeMs: z.number(),
      durationMs: z.number().nullable(),
      paused: z.boolean(),
      muted: z.boolean(),
      volume: z.number(),
    })
    .nullable(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  service: z.object({ id: z.string(), title: z.string() }).nullable(),
  timer: z.object({ endsAt: z.number(), itemIndex: z.int() }).nullable(),
  rotation: z.object({ durationMs: z.number(), paused: z.boolean() }).nullable(),
}) satisfies z.ZodType<LiveState>;

const index = z.int().min(0).max(100_000);

export const liveStartInputSchema = z
  .object({
    startAt: z.object({ itemIndex: index, slideIndex: index }).optional(),
  })
  .optional();

export const liveVideoInputSchema = z.object({
  action: z.enum(VIDEO_ACTIONS),
  /** seek: ms · volume: 0–1 · mute: 1/0 (omit to toggle). */
  value: z.number().min(0).max(86_400_000).optional(),
});

export const onInputSchema = z.object({ on: z.boolean() });
export const slideIndexInputSchema = z.object({ slideIndex: index });
export const itemIndexInputSchema = z.object({ itemIndex: index });
export const displayIdInputSchema = z.object({ displayId: z.number().int() });
