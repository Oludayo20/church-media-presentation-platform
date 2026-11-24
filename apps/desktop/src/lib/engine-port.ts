import type { EngineCommand, EngineMessage } from "@cmp/shared-validation";

type CommandListener = (command: EngineCommand) => void;

/**
 * Receives the engine MessagePort that main sends on every page load
 * (DOCUMENTATION.md §2.4). The preload forwards it with window.postMessage;
 * only messages from this very window are accepted.
 */
export function listenForEnginePort(
  onPort: (port: MessagePort) => void,
): () => void {
  const handler = (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as { type?: unknown } | null;
    if (data?.type !== "cmp:engine-port" || !event.ports[0]) return;
    onPort(event.ports[0]);
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/**
 * The operator window's mirror channel. The port arrives once per page load,
 * possibly before or after the Live page mounts, so listeners attach here
 * and ask main for a replay to get the current picture.
 */
class MirrorBus {
  private port: MessagePort | null = null;
  private readonly listeners = new Set<CommandListener>();

  constructor() {
    listenForEnginePort((port) => {
      this.port?.close();
      this.port = port;
      port.onmessage = (event: MessageEvent<EngineCommand>) => {
        for (const listener of this.listeners) listener(event.data);
      };
      if (this.listeners.size > 0) this.requestReplay();
    });
  }

  subscribe(listener: CommandListener): () => void {
    this.listeners.add(listener);
    this.requestReplay();
    return () => this.listeners.delete(listener);
  }

  report(message: EngineMessage): void {
    this.port?.postMessage(message);
  }

  private requestReplay(): void {
    this.port?.postMessage({ type: "replay" } satisfies EngineMessage);
  }
}

export const mirrorBus = new MirrorBus();
