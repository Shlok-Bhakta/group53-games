import type { CSSProperties } from "react";

export type TileState = "blank" | "green" | "yellow" | "gray" | "hit" | "empty";

export function Tiles({
  word,
  states,
  size = "md",
  flip = false,
  label,
}: {
  word: string;
  states?: TileState[];
  size?: "sm" | "md" | "lg" | "xl";
  flip?: boolean;
  label?: string;
}) {
  return (
    <div className={`tiles tiles-${size}${flip ? " tiles-flip" : ""}`} role="img" aria-label={label ?? word}>
      {[...word].map((ch, i) => (
        <span key={i} className={`tile tile-${states?.[i] ?? "blank"}`} style={{ "--i": i } as CSSProperties} aria-hidden="true">
          {ch.trim()}
        </span>
      ))}
    </div>
  );
}
