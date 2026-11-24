import { cn } from "@cmp/design-system";
import { OUTPUT_RESOLUTIONS, type Settings } from "@cmp/shared-validation";

type Resolution = Settings["display.outputResolution"];

interface ResolutionPickerProps {
  value: Resolution;
  onChange(value: Resolution): void;
}

export function ResolutionPicker({ value, onChange }: ResolutionPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Output resolution"
      className="grid grid-cols-2 gap-2"
    >
      {OUTPUT_RESOLUTIONS.map(({ w, h, label }) => {
        const checked = value.w === w && value.h === h;
        return (
          <button
            key={`${w}x${h}`}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange({ w, h })}
            className={cn(
              "rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              checked
                ? "border-primary bg-primary/10"
                : "border-border bg-surface hover:bg-surface-raised",
            )}
          >
            <span className="block text-sm font-medium">{label}</span>
            <span className="block text-xs text-muted">
              {w} × {h}
            </span>
          </button>
        );
      })}
    </div>
  );
}
