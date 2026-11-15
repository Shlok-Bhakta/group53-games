import { cn } from "@/lib/utils";

export function SeatDot({ color, size = "sm", className }: { color: string | undefined; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      className={cn("shrink-0 rounded-full", size === "sm" ? "size-2" : "size-2.5", className)}
      style={{ background: color }}
      aria-hidden="true"
    />
  );
}
