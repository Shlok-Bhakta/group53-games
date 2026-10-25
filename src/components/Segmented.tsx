import { useId, type ReactNode } from "react";
import { RadioGroup } from "radix-ui";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

// A segmented control: equal segments, one selected, 44px tall. The selection slides between segments.
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
  const id = useId();
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
            "relative flex h-11 touch-manipulation items-center justify-center gap-1.5 rounded-sm text-callout font-semibold text-muted-foreground outline-none transition-colors",
            "focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=checked]:text-foreground",
            "[&_svg]:size-[18px]",
          )}
        >
          {o.value === value && (
            <motion.span
              layoutId={`segment-${id}`}
              className="absolute inset-0 -z-0 rounded-sm bg-card shadow-sm dark:bg-foreground/15"
              transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            {o.icon}
            {o.label}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
