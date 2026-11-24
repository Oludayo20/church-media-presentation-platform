/**
 * Audience window entry. Deliberately React-free: it only boots the
 * presentation engine (docs/ARCHITECTURE.md §2.3) and connects it to main's
 * command port. `?identify=N` turns it into the "which screen is which"
 * overlay instead (DOCUMENTATION.md §4.1).
 */
import {
  createPresentationEngine,
  type EngineCommand,
  type EngineMessage,
} from "@cmp/presentation-engine";
import { listenForEnginePort } from "../lib/engine-port";

const root = document.getElementById("output")!;
const params = new URLSearchParams(window.location.search);
const identify = params.get("identify");

if (identify) {
  showIdentify(identify, params.get("label") ?? "");
} else {
  let port: MessagePort | null = null;
  const engine = createPresentationEngine(root, {
    mode: "output",
    onState: (state) =>
      port?.postMessage({ type: "state", state } satisfies EngineMessage),
  });
  listenForEnginePort((received) => {
    port?.close();
    port = received;
    port.onmessage = (event: MessageEvent<EngineCommand>) => {
      void engine.apply(event.data);
    };
  });
}

function showIdentify(number: string, label: string): void {
  Object.assign(document.body.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    color: "#fff",
    fontFamily: "Inter, system-ui, sans-serif",
    cursor: "none",
  });
  const big = document.createElement("div");
  Object.assign(big.style, {
    fontSize: "40vmin",
    fontWeight: "800",
    lineHeight: "1",
  });
  big.textContent = number;
  const caption = document.createElement("div");
  Object.assign(caption.style, {
    fontSize: "4vmin",
    opacity: "0.8",
    marginTop: "2vmin",
  });
  caption.textContent = label;
  root.replaceChildren(big, caption);
}
