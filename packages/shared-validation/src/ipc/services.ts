import { z } from "zod";
import type { ServiceData, ServiceDetail, ServiceItemOptions, ServiceListItem } from "@cmp/shared-types";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");
const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const SERVICE_ITEM_TYPES = [
  "presentation",
  "song",
  "scripture",
  "video",
  "image",
  "countdown",
  "announcement",
  "blank",
  "camera_placeholder",
] as const;

/** Item types that point at a presentation, song or media asset. */
export const REFERENCED_ITEM_TYPES = ["presentation", "song", "video", "image", "announcement"] as const;

/** Per-type options (DOCUMENTATION.md §8.1), validated on every write. */
export const serviceItemOptionsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("presentation") }),
  z.object({
    type: z.literal("song"),
    templateId: z.string().max(40).nullable().default(null),
    backgroundAssetId: id.nullable().default(null),
  }),
  z.object({
    type: z.literal("scripture"),
    translation: z.string().trim().min(1).max(16),
    /** Empty in template placeholders until a passage is chosen. */
    reference: z.string().trim().max(300),
    onePerSlide: z.boolean().default(false),
  }),
  z.object({ type: z.literal("video"), loop: z.boolean().default(false), muted: z.boolean().default(false) }),
  z.object({ type: z.literal("image") }),
  z.object({
    type: z.literal("countdown"),
    durationMs: z.int().min(10_000).max(6 * 3600 * 1000).default(600_000),
    title: z.string().trim().max(80).default("Service starts in"),
    backgroundAssetId: id.nullable().default(null),
    onComplete: z.enum(["next_item", "hold", "logo"]).default("next_item"),
    chime: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("announcement"),
    durationMs: z.int().min(2000).max(120_000).default(8000),
    loop: z.boolean().default(true),
  }),
  z.object({ type: z.literal("blank"), mode: z.enum(["black", "logo"]).default("black") }),
  z.object({ type: z.literal("camera_placeholder") }),
]) satisfies z.ZodType<ServiceItemOptions, z.input<z.ZodType>>;

export const serviceItemSchema = z
  .object({
    id,
    groupId: id.nullable(),
    itemType: z.enum(SERVICE_ITEM_TYPES),
    refId: id.nullable(),
    options: serviceItemOptionsSchema,
    label: nullableText(120),
    notes: nullableText(2000),
  })
  .refine((item) => item.options.type === item.itemType, "Item options do not match the item type");

export const serviceDataSchema = z.object({
  title: z.string().trim().min(1, "Give the service a title").max(200),
  serviceType: nullableText(40),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable(),
  theme: nullableText(200),
  description: nullableText(2000),
  groups: z.array(z.object({ id, name: z.string().trim().min(1).max(80) })).max(50),
  items: z.array(serviceItemSchema).max(300),
}) satisfies z.ZodType<ServiceData, z.input<z.ZodType>>;

export const serviceDetailSchema = serviceDataSchema.extend({
  id: z.string(),
  status: z.enum(["draft", "ready", "live", "completed", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<ServiceDetail, z.input<z.ZodType>>;

export const serviceListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  serviceType: z.string().nullable(),
  serviceDate: z.string().nullable(),
  startTime: z.string().nullable(),
  status: z.string(),
  itemCount: z.number(),
  updatedAt: z.string(),
}) satisfies z.ZodType<ServiceListItem>;

export const serviceTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  itemCount: z.number(),
  builtIn: z.boolean(),
});

export const servicePreviewItemSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  problem: z.string().nullable(),
  slideCount: z.number(),
});

export const serviceCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  templateId: z.string().max(64).nullable().optional(),
});
