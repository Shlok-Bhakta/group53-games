import { useEffect, useRef } from "react";
import { useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { sfx } from "@/sound";

// A turn timer as a chip: m:ss, quiet on someone else's turn, the primary color on yours, red for the last ten
// seconds. The last five seconds of your own turn tick.
export function Countdown({ deadline, mine }: { deadline: number; mine: boolean }) {
  const now = useNow(250);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const ticked = useRef(left);
  useEffect(() => {
    if (mine && left !== ticked.current && left > 0 && left <= 5) sfx("tick");
    ticked.current = left;
  }, [left, mine]);
  const urgent = left <= 10;
  return (
    <span
      className={cn("shrink-0 rounded-full px-2.5 py-1 font-display text-callout tabular-nums", urgent ? "bg-[var(--tile-hit)] text-[var(--tile-hit-ink)]" : mine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
      aria-label={`${left} seconds left`}
    >
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}
