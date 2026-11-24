import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@cmp/design-system";
import type { SongSectionData } from "@cmp/shared-types";
import { chipLabel } from "../sections";

/**
 * The arrangement as draggable chips (`V1 C V2 C B C`): click a section
 * below to append it, drag chips to reorder, × to remove.
 */
export function ArrangementBuilder({
  sections,
  arrangement,
  onChange,
}: {
  sections: SongSectionData[];
  arrangement: string[];
  onChange(arrangement: string[]): void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const byId = new Map(sections.map((section) => [section.id, section]));
  const order = arrangement.filter((id) => byId.has(id));

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <ol
        aria-label="Arrangement"
        className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border p-2"
      >
        {order.length === 0 && (
          <li className="text-xs text-muted">
            Click sections below to build the order.
          </li>
        )}
        {order.map((id, index) => {
          const section = byId.get(id)!;
          return (
            <li
              key={`${id}-${index}`}
              draggable
              data-testid="arrangement-chip"
              onDragStart={(event) => {
                setDragging(index);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null) move(dragging, index);
                setDragging(null);
              }}
              onDragEnd={() => setDragging(null)}
              title={section.label}
              className={cn(
                "inline-flex cursor-grab items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold",
                section.type === "chorus"
                  ? "bg-primary/20 text-primary"
                  : "bg-surface-raised",
                dragging === index && "opacity-40",
              )}
            >
              {chipLabel(section.type, section.label)}
              <button
                type="button"
                aria-label={`Remove ${section.label} at position ${index + 1}`}
                onClick={() => onChange(order.filter((_, i) => i !== index))}
                className="text-muted hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">Add:</span>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => onChange([...order, section.id])}
            className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-surface-raised"
            title={`Add ${section.label}`}
          >
            + {chipLabel(section.type, section.label)}
          </button>
        ))}
        {order.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(sections.map((section) => section.id))}
            className="ml-auto text-xs text-muted underline hover:text-foreground"
          >
            Reset to section order
          </button>
        )}
      </div>
    </div>
  );
}
