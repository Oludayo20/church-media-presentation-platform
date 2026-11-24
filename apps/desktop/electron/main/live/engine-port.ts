import {
  MessageChannelMain,
  type MessagePortMain,
  type WebContents,
} from "electron";
import type {
  EngineCommandBody,
  EngineMessage,
  EngineState,
} from "@cmp/shared-validation";
import type { EngineSink } from "./live-session";

export interface EnginePortHandlers {
  onState(state: EngineState): void;
  /** The page asked for a full replay (an engine mounted late). */
  onReplay(): void;
}

/**
 * The audience channel (DOCUMENTATION.md §2.4): a `MessageChannelMain` per
 * window, `port2` transferred with `webContents.postMessage('engine:port')`.
 * Every command gets this window's next sequence number, so engines can
 * drop duplicates and stale replays.
 */
export class EnginePort implements EngineSink {
  private port: MessagePortMain | null = null;
  private seq = 0;

  constructor(
    readonly id: string,
    private readonly handlers: EnginePortHandlers,
  ) {}

  /** (Re)connects to a freshly loaded page. */
  connect(contents: WebContents): void {
    this.port?.close();
    const { port1, port2 } = new MessageChannelMain();
    port1.on("message", ({ data }) => this.receive(data as EngineMessage));
    port1.start();
    this.port = port1;
    contents.postMessage("engine:port", null, [port2]);
  }

  get connected(): boolean {
    return this.port !== null;
  }

  send(command: EngineCommandBody): void {
    this.port?.postMessage({ ...command, seq: ++this.seq });
  }

  close(): void {
    this.port?.close();
    this.port = null;
  }

  private receive(message: EngineMessage): void {
    if (message?.type === "state") this.handlers.onState(message.state);
    else if (message?.type === "replay") this.handlers.onReplay();
  }
}
