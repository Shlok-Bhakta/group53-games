import type { CSSProperties } from "react";
import type { PlayerCard as Card } from "../../convex/profiles";
import { OnlineDot } from "@/presence";
import { cn } from "@/lib/utils";

type Props = {
  player: Card;
  online?: boolean;
  size?: "grid" | "hero";
  className?: string;
};

// Trading-card style: the Discord avatar is the art, fading into the card so the text sits on it.
export function PlayerCard({ player, online, size = "grid", className }: Props) {
  const hero = size === "hero";
  return (
    <div
      className={cn("frame pcard", hero ? "aspect-[5/6]" : "aspect-[3/4]", className)}
      data-frame={player.frame}
      data-glow={player.glow}
      style={{ "--frame-color": player.frameColor } as CSSProperties}
    >
      <div className="pcard-inner">
        {player.image ? (
          <img className="pcard-art" src={player.image} alt="" draggable={false} referrerPolicy="no-referrer" />
        ) : (
          <div className="pcard-art pcard-art-empty" aria-hidden="true">
            {player.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="pcard-fx" data-effect={player.effect} />
        {online !== undefined && (
          <span className={cn("absolute z-10", hero ? "left-4 top-4" : "left-3 top-3")}>
            <OnlineDot online={online} />
          </span>
        )}
        {player.badge && (
          <span
            className={cn(
              "absolute z-10 grid place-items-center rounded-full bg-black/30 backdrop-blur-md",
              hero ? "right-3.5 top-3.5 size-12 text-title" : "right-2.5 top-2.5 size-9 text-heading",
            )}
            aria-hidden="true"
          >
            {player.badge}
          </span>
        )}
        <div className={cn("pcard-body z-10", hero && "px-5 pb-5")}>
          <h3 className={cn("pcard-name font-display truncate leading-tight", hero ? "text-title" : "text-body")}>{player.name}</h3>
          {player.username && player.username !== player.name && (
            <p className={cn("truncate text-muted-foreground", hero ? "text-callout" : "text-footnote")}>@{player.username}</p>
          )}
          {player.tagline && (
            <p className={cn("mt-1 line-clamp-2 text-foreground/85", hero ? "text-callout" : "text-footnote")}>{player.tagline}</p>
          )}
        </div>
      </div>
    </div>
  );
}
