import type { ReactNode } from "react";
import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/utils";

// An iOS-style segmented control: equal segments, one selected, 44px tall.
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  label: string;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(v) => onChange(v as T)}
      className="grid rounded-md bg-muted p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            "flex h-11 touch-manipulation items-center justify-center gap-1.5 rounded-sm text-callout font-semibold text-muted-foreground outline-none transition-colors",
            "focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=checked]:bg-card data-[state=checked]:text-foreground data-[state=checked]:shadow-sm dark:data-[state=checked]:bg-foreground/15",
            "[&_svg]:size-[18px]",
          )}
        >
          {o.icon}
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
