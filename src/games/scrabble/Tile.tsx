import type { CSSProperties } from "react";
import { VALUES, type Premium } from "../../../convex/scrabble/engine";
import { cn } from "@/lib/utils";

// One letter tile. Blanks show the letter they play as, greyed, and no points.
export function LetterTile({ letter, blank, size, seat, className, style }: { letter: string; blank?: boolean; size: number; seat?: string; className?: string; style?: CSSProperties }) {
  const shown = letter === "?" ? "" : letter;
  return (
    <span className={cn("stile", blank && "stile-blank", className)} style={{ "--size": `${size}px`, ...(seat ? { "--seat": seat } : {}), ...style } as CSSProperties} aria-hidden="true">
      {shown}
      {!blank && letter !== "?" && <span className="stile-value">{VALUES[letter]}</span>}
    </span>
  );
}

// Bonus squares: 2L blue, 3L yellow, 2W green, 3W red, the centre a star on green.
export const PREMIUM_STYLE: Record<Premium, { bg: string; ink: string; label: string } | null> = {
  ".": null,
  d: { bg: "color-mix(in oklch, #3f7be0 75%, var(--card))", ink: "#ffffff", label: "2L" },
  t: { bg: "var(--tile-yellow)", ink: "var(--tile-yellow-ink)", label: "3L" },
  D: { bg: "var(--tile-green)", ink: "var(--tile-ink)", label: "2W" },
  T: { bg: "var(--tile-hit)", ink: "var(--tile-hit-ink)", label: "3W" },
  "*": { bg: "var(--tile-green)", ink: "var(--tile-ink)", label: "★" },
};
