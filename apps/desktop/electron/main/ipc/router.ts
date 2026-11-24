import { z } from "zod";
import { fail, isAppError, ok, type IpcResult } from "@cmp/shared-types";
import {
  ipcChannels,
  type ChannelOutput,
  type ChannelPayload,
  type IpcChannel,
} from "@cmp/shared-validation";
import type { Logger } from "../logging/logger";

/** The parts of `ipcMain` / `IpcMainInvokeEvent` the router uses. */
export interface InvokeEventLike {
  senderFrame: { url: string } | null;
}
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: InvokeEventLike, payload: unknown) => Promise<unknown>,
  ): void;
}

export type IpcHandler<C extends IpcChannel> = (
  input: ChannelPayload<C>,
  event: InvokeEventLike,
) => ChannelOutput<C> | Promise<ChannelOutput<C>>;

/** One handler per registered channel: a missing one is a type error. */
export type IpcHandlers = { [C in IpcChannel]: IpcHandler<C> };

export interface RouterOptions {
  /** Rejects IPC from frames outside the app bundle. */
  isTrustedSender(url: string): boolean;
  logger: Logger;
}

/**
 * The IPC router (DOCUMENTATION.md §2.2–2.3). For every channel it:
 *
 * 1. rejects calls from untrusted frames;
 * 2. validates the payload with the channel's shared Zod schema, answering
 *    `VALIDATION_ERROR` with the issues and never calling the handler;
 * 3. maps thrown `AppError`s to their code and anything else to `INTERNAL`
 *    (logged, with no internals leaked to the renderer);
 * 4. validates the handler's result against the output schema.
 *
 * It refuses to start if the handler set and the schema registry differ.
 */
export function registerIpcRouter(
  ipc: IpcMainLike,
  handlers: IpcHandlers,
  options: RouterOptions,
): IpcChannel[] {
  assertHandlersMatchRegistry(handlers);
  const channels = Object.keys(ipcChannels) as IpcChannel[];
  for (const channel of channels) {
    ipc.handle(channel, (event, payload) =>
      dispatch(channel, handlers[channel], event, payload, options),
    );
  }
  return channels;
}

export function assertHandlersMatchRegistry(handlers: object): void {
  const registered = new Set(Object.keys(ipcChannels));
  const provided = new Set(Object.keys(handlers));
  const withoutHandler = [...registered].filter((c) => !provided.has(c));
  const withoutSchema = [...provided].filter((c) => !registered.has(c));
  if (withoutHandler.length > 0 || withoutSchema.length > 0) {
    throw new Error(
      `IPC registry mismatch. Channels without a handler: [${withoutHandler.join(", ")}]. Handlers without a schema: [${withoutSchema.join(", ")}].`,
    );
  }
}

async function dispatch<C extends IpcChannel>(
  channel: C,
  handler: IpcHandler<C>,
  event: InvokeEventLike,
  payload: unknown,
  { isTrustedSender, logger }: RouterOptions,
): Promise<IpcResult<ChannelOutput<C>>> {
  const senderUrl = event.senderFrame?.url ?? "";
  if (!isTrustedSender(senderUrl)) {
    logger.warn(`[ipc] rejected ${channel} from untrusted frame ${senderUrl}`);
    return fail("INTERNAL", "Rejected IPC from an untrusted frame");
  }

  const schema = ipcChannels[channel];
  const parsed = schema.input.safeParse(payload);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      `Invalid payload for ${channel}`,
      parsed.error.issues,
    );
  }

  let result: ChannelOutput<C>;
  try {
    result = await handler(parsed.data as ChannelPayload<C>, event);
  } catch (error) {
    if (isAppError(error)) {
      return fail(error.code, error.message, error.details);
    }
    if (error instanceof z.ZodError) {
      return fail(
        "VALIDATION_ERROR",
        `Invalid value for ${channel}`,
        error.issues,
      );
    }
    logger.error(`[ipc] ${channel} failed`, error);
    return fail("INTERNAL", `${channel} failed`);
  }

  const output = schema.output.safeParse(result);
  if (!output.success) {
    logger.error(`[ipc] ${channel} returned an invalid result`, output.error);
    return fail("INTERNAL", `${channel} failed`);
  }
  return ok(output.data as ChannelOutput<C>);
}
