import { z } from "zod";
import type { AppInfo } from "@cmp/shared-types";

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  electron: z.string(),
  chrome: z.string(),
}) satisfies z.ZodType<AppInfo>;
