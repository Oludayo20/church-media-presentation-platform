/**
 * Audience window entry. Deliberately React-free: it only boots the
 * presentation engine (docs/ARCHITECTURE.md §2.3). The engine's command
 * channel (MessagePort) is wired in Phase 2.
 */
import { createOutputSurface } from "@cmp/presentation-engine";

const root = document.getElementById("output");
if (root) createOutputSurface(root);
