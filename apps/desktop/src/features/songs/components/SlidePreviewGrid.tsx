import type { EngineDocument } from "@cmp/shared-validation";
import { SlidePreview } from "../../live/components/EngineViews";

/**
 * Generated slides grouped by section label (DOCUMENTATION.md §5.2 step 5),
 * exactly as the projector will show them.
 */
export function SlidePreviewGrid({
  doc,
  current,
  onSelect,
}: {
  doc: EngineDocument;
  current?: number;
  onSelect?(index: number): void;
}) {
  const groups: { label: string; start: number; count: number }[] = [];
  doc.slides.forEach((slide, index) => {
    const label = String(slide.meta?.["sectionLabel"] ?? "");
    const last = groups.at(-1);
    if (last && last.label === label && last.start + last.count === index)
      last.count += 1;
    else groups.push({ label, start: index, count: 1 });
  });

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section
          key={`${group.label}-${group.start}`}
          aria-label={group.label || "Slides"}
        >
          {group.label && (
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {group.label}
            </h3>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
            {Array.from({ length: group.count }, (_, offset) => {
              const index = group.start + offset;
              const content = (
                <>
                  <SlidePreview
                    doc={doc}
                    slideIndex={index}
                    label={`Slide ${index + 1}`}
                  />
                  <span className="mt-0.5 block text-[11px] text-muted">
                    {index + 1}
                  </span>
                </>
              );
              return onSelect ? (
                <button
                  key={doc.slides[index]!.id}
                  type="button"
                  data-testid="song-slide"
                  aria-label={`Slide ${index + 1}`}
                  aria-current={index === current ? "true" : undefined}
                  onClick={() => onSelect(index)}
                  className={
                    index === current
                      ? "rounded-md p-0.5 text-left ring-2 ring-live"
                      : "rounded-md p-0.5 text-left hover:ring-1 hover:ring-border"
                  }
                >
                  {content}
                </button>
              ) : (
                <div
                  key={doc.slides[index]!.id}
                  data-testid="song-slide"
                  className="p-0.5"
                >
                  {content}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
