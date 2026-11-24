import type { IpcResult } from "@cmp/shared-types";
import type {
  ChannelInput,
  ChannelOutput,
  EventPayload,
  IpcChannel,
  IpcEvent,
} from "./ipc/channels";

type Namespace<C extends string> = C extends `${infer N}:${string}` ? N : never;

type Method<C extends IpcChannel> =
  ChannelInput<C> extends undefined
    ? () => Promise<IpcResult<ChannelOutput<C>>>
    : undefined extends ChannelInput<C>
      ? (input?: ChannelInput<C>) => Promise<IpcResult<ChannelOutput<C>>>
      : (input: ChannelInput<C>) => Promise<IpcResult<ChannelOutput<C>>>;

type Subscribe<E extends IpcEvent> = (
  listener: (payload: EventPayload<E>) => void,
) => () => void;

/**
 * The typed `window.cmp` surface, derived from the channel registry so the
 * preload, the renderer and the main-process router cannot drift apart.
 * `"settings:set"` becomes `window.cmp.settings.set(input)`, and the push
 * event `"live:state"` becomes `window.cmp.live.onState(listener)`, which
 * returns an unsubscribe function.
 * Type-only: importing it pulls no Zod into the renderer bundle.
 */
export type CmpApi = {
  readonly [N in Namespace<IpcChannel | IpcEvent>]: {
    readonly [
      C in IpcChannel as C extends `${N}:${infer M}` ? M : never
    ]: Method<C>;
  } & {
    readonly [
      E in IpcEvent as E extends `${N}:${infer Name}`
        ? `on${Capitalize<Name>}`
        : never
    ]: Subscribe<E>;
  };
};
