import { cn } from "@/lib/utils";

// A player's seat color as a dot, next to their name in a list or a status line.
export function SeatDot({ color, size = "sm", className }: { color: string | undefined; size?: "sm" | "md"; className?: string }) {
  return <span className={cn("shrink-0 rounded-full", size === "sm" ? "size-2" : "size-2.5", className)} style={{ background: color }} aria-hidden="true" />;
}
