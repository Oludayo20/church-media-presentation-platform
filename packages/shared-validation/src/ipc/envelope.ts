import { z } from "zod";
import { ERROR_CODES } from "@cmp/shared-types";

export const errorCodeSchema = z.enum(ERROR_CODES);

export const ipcErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});

/** Builds a schema for `IpcResult<T>` given the schema of `T`. */
export function ipcResultSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("success", [
    z.object({ success: z.literal(true), data }),
    z.object({ success: z.literal(false), error: ipcErrorSchema }),
  ]);
}
