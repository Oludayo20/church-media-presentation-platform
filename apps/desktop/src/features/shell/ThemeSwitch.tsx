import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@cmp/design-system";
import type { Theme } from "@cmp/shared-validation";

const OPTIONS = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
] as const satisfies readonly { value: Theme; label: string; icon: unknown }[];

interface ThemeSwitchProps {
  value: Theme;
  onChange(theme: Theme): void;
  className?: string;
}

/** Compact three-way theme toggle (a radio group). */
export function ThemeSwitch({ value, onChange, className }: ThemeSwitchProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex rounded-md border border-border bg-surface p-0.5",
        className,
      )}
    >
      {OPTIONS.map(({ value: option, label, icon: Icon }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          aria-label={label}
          title={label}
          onClick={() => onChange(option)}
          className={cn(
            "inline-flex h-7 w-8 items-center justify-center rounded text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === option && "bg-surface-raised text-foreground shadow-sm",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
