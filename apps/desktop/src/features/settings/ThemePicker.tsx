import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@cmp/design-system";
import type { Theme } from "@cmp/shared-validation";

const OPTIONS = [
  {
    value: "dark",
    label: "Dark",
    hint: "Best in a dim control room",
    icon: Moon,
  },
  { value: "light", label: "Light", hint: "For bright rooms", icon: Sun },
  {
    value: "system",
    label: "System",
    hint: "Follow this computer",
    icon: Monitor,
  },
] as const;

interface ThemePickerProps {
  value: Theme;
  onChange(theme: Theme): void;
}

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="grid grid-cols-3 gap-2"
    >
      {OPTIONS.map(({ value: option, label, hint, icon: Icon }) => {
        const checked = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(option)}
            className={cn(
              "flex flex-col items-start gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              checked
                ? "border-primary bg-primary/10"
                : "border-border bg-surface hover:bg-surface-raised",
            )}
          >
            <Icon className="size-4 text-muted" aria-hidden />
            <span className="text-sm font-medium">{label}</span>
            <span className="text-xs text-muted">{hint}</span>
          </button>
        );
      })}
    </div>
  );
}
