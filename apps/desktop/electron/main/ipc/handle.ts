import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { fail, ok, type IpcResult } from "@cmp/shared-types";
import {
  ipcChannels,
  type ChannelInput,
  type ChannelOutput,
  type IpcChannel,
} from "@cmp/shared-validation";
import { devServerUrl, rendererDir } from "../paths";
import { isAppUrl } from "../security/app-url";

/**
 * Registers an IPC handler that (1) rejects calls from frames outside the
 * app bundle, (2) validates the payload with the channel's shared Zod
 * schema, and (3) always answers with the IpcResult envelope.
 * Phase 1 grows this into the full router (docs/DOCUMENTATION.md §2.2).
 */
export function handle<C extends IpcChannel>(
  channel: C,
  handler: (
    input: ChannelInput<C>,
    event: IpcMainInvokeEvent,
  ) => ChannelOutput<C> | Promise<ChannelOutput<C>>,
): void {
  const schema = ipcChannels[channel];

  ipcMain.handle(
    channel,
    async (event, payload: unknown): Promise<IpcResult<ChannelOutput<C>>> => {
      const senderUrl = event.senderFrame?.url ?? "";
      if (!isAppUrl(senderUrl, devServerUrl, rendererDir)) {
        return fail("INTERNAL", "Rejected IPC from an untrusted frame");
      }

      const parsed = schema.input.safeParse(payload);
      if (!parsed.success) {
        return fail(
          "VALIDATION_ERROR",
          `Invalid payload for ${channel}`,
          parsed.error.issues,
        );
      }

      try {
        return ok(await handler(parsed.data as ChannelInput<C>, event));
      } catch (error) {
        console.error(`[ipc] ${channel} failed`, error);
        return fail("INTERNAL", `${channel} failed`);
      }
    },
  );
}
