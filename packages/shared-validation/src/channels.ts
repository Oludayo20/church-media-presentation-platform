import { z } from "zod";
import type { AppInfo } from "@cmp/shared-types";

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  electron: z.string(),
  chrome: z.string(),
}) satisfies z.ZodType<AppInfo>;

/**
 * The single source of truth for IPC channels: the input schema the main
 * process validates against, and the output schema of `data`.
 * Phase 1 grows this map and adds a test asserting every registered
 * handler has an entry (docs/DOCUMENTATION.md §2.2).
 */
export const ipcChannels = {
  "app:info": { input: z.undefined(), output: appInfoSchema },
} as const;

export type IpcChannel = keyof typeof ipcChannels;
export type ChannelInput<C extends IpcChannel> = z.input<
  (typeof ipcChannels)[C]["input"]
>;
export type ChannelOutput<C extends IpcChannel> = z.output<
  (typeof ipcChannels)[C]["output"]
>;
