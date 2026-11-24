import { useRef, useState, type PointerEvent } from "react";
import type { EngineDocument, Frame } from "@cmp/shared-validation";
import { SlidePreview } from "../live/components/EngineViews";

interface Gesture {
  frame: Frame;
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
}

export function EditorCanvas({
  doc,
  index,
  selected,
  safeArea,
  snap,
  onSelect,
  onCommit,
}: {
  doc: EngineDocument;
  index: number;
  selected: string;
  safeArea: boolean;
  snap: boolean;
  onSelect(id: string): void;
  onCommit(id: string, frame: Frame): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>(null);
  const [draft, setDraft] = useState<{ id: string; frame: Frame }>();
  const slide = doc.slides[index]!;

  function start(
    event: PointerEvent<HTMLButtonElement>,
    id: string,
    frame: Frame,
    mode: Gesture["mode"],
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect(id);
    gesture.current = {
      id,
      frame,
      mode,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function update(event: PointerEvent<HTMLButtonElement>) {
    if (
      !gesture.current ||
      !root.current ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    )
      return;
    const { frame, id, mode, startX, startY } = gesture.current;
    const bounds = root.current.getBoundingClientRect();
    const x = ((event.clientX - startX) * doc.width) / bounds.width;
    const y = ((event.clientY - startY) * doc.height) / bounds.height;
    if (Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) < 2)
      return;
    const grid = (value: number) =>
      snap ? Math.round(value / 10) * 10 : Math.round(value);
    const next =
      mode === "move"
        ? { ...frame, x: grid(frame.x + x), y: grid(frame.y + y) }
        : {
            ...frame,
            w: Math.max(10, grid(frame.w + x)),
            h: Math.max(10, grid(frame.h + y)),
          };
    setDraft({ id, frame: next });
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    if (
      !gesture.current ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    )
      return;
    if (draft?.id === gesture.current.id) onCommit(draft.id, draft.frame);
    cancel();
  }

  function cancel() {
    gesture.current = null;
    setDraft(undefined);
  }

  return (
    <div ref={root} className="relative overflow-hidden">
      <SlidePreview
        doc={doc}
        slideIndex={index}
        label="Presentation canvas"
        aspectRatio={`${doc.width} / ${doc.height}`}
      />
      {safeArea && (
        <div
          className="pointer-events-none absolute inset-[5%] border border-dashed border-white/60"
          aria-hidden
        />
      )}
      {slide.objects.map((object) => {
        const frame = draft?.id === object.id ? draft.frame : object.frame;
        return (
          <div
            key={object.id}
            className="pointer-events-none absolute"
            style={{
              left: `${(frame.x * 100) / doc.width}%`,
              top: `${(frame.y * 100) / doc.height}%`,
              width: `${(frame.w * 100) / doc.width}%`,
              height: `${(frame.h * 100) / doc.height}%`,
              zIndex: object.id === selected ? 1 : undefined,
            }}
          >
            <button
              type="button"
              aria-label={`Select ${object.type} on canvas`}
              aria-pressed={object.id === selected}
              className={`pointer-events-auto absolute inset-0 touch-none cursor-move border ${object.id === selected ? "border-primary" : "border-transparent hover:border-white/50"}`}
              onClick={() => onSelect(object.id)}
              onPointerDown={(event) =>
                start(event, object.id, object.frame, "move")
              }
              onPointerMove={update}
              onPointerUp={finish}
              onLostPointerCapture={cancel}
            />
            {object.id === selected && (
              <button
                type="button"
                tabIndex={-1}
                aria-label="Resize selected object"
                className="pointer-events-auto absolute -right-1 -bottom-1 size-3 touch-none cursor-nwse-resize rounded-sm border border-white bg-primary"
                onPointerDown={(event) =>
                  start(event, object.id, object.frame, "resize")
                }
                onPointerMove={update}
                onPointerUp={finish}
                onLostPointerCapture={cancel}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
