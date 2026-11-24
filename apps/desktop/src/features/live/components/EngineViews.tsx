import { useEffect, useRef } from "react";
import {
  createPresentationEngine,
  renderStaticSlide,
  type EngineDocument,
} from "@cmp/presentation-engine";
import { cn } from "@cmp/design-system";
import { mirrorBus } from "../../../lib/engine-port";

/**
 * The audience mirror: a real engine in preview mode (muted) fed the exact
 * command stream the projector gets. In single-display mode this *is* the
 * output (DOCUMENTATION.md §4.3 "preview mode").
 */
export function AudienceMirror({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const engine = createPresentationEngine(root, {
      mode: "preview",
      onState: (state) => mirrorBus.report({ type: "state", state }),
    });
    const unsubscribe = mirrorBus.subscribe(
      (command) => void engine.apply(command),
    );
    return () => {
      unsubscribe();
      engine.destroy();
    };
  }, []);
  return (
    <Frame className={className}>
      <div
        ref={ref}
        data-testid="audience-mirror"
        className="absolute inset-0"
      />
    </Frame>
  );
}

/** One slide, cut, videos frozen on their first frame. */
export function SlidePreview({
  doc,
  slideIndex,
  className,
  label,
  aspectRatio,
}: {
  doc: EngineDocument | null;
  slideIndex: number;
  className?: string;
  label?: string;
  aspectRatio?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !doc || !doc.slides[slideIndex]) return;
    const engine = renderStaticSlide(root, doc, slideIndex);
    return () => engine.destroy();
  }, [doc, slideIndex]);
  return (
    <Frame className={className} aspectRatio={aspectRatio}>
      <div ref={ref} aria-label={label} className="absolute inset-0" />
      {(!doc || !doc.slides[slideIndex]) && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
          —
        </div>
      )}
    </Frame>
  );
}

function Frame({
  className,
  children,
  aspectRatio,
}: {
  className?: string | undefined;
  children: React.ReactNode;
  aspectRatio?: string | undefined;
}) {
  return (
    <div
      style={aspectRatio ? { aspectRatio } : undefined}
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-md border border-border bg-black",
        className,
      )}
    >
      {children}
    </div>
  );
}
