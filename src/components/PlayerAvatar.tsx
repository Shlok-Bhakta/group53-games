import type { CSSProperties } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const FALLBACK_DELAY_MS = 600;

export type FrameStyle = { frame?: string; frameColor?: string; glow?: boolean };
export type Face = FrameStyle & { name: string; image?: string };

type Props = FrameStyle & {
  player?: Face;
  name?: string;
  image?: string;
  badge?: string;
  size?: number;
  online?: boolean;
  dotRing?: "card" | "background";
  seat?: string;
  className?: string;
};

export function PlayerAvatar({
  player,
  name = player?.name ?? "",
  image = player?.image,
  frame = player?.frame ?? "none",
  frameColor = player?.frameColor,
  glow = false,
  badge,
  size = 48,
  online,
  dotRing = "card",
  seat,
  className,
}: Props) {
  const face = (
    <span
      className={cn("pa", className)}
      data-seat={seat ? "" : undefined}
      style={{ "--s": `${size}px`, "--frame-color": frameColor, "--seat": seat } as CSSProperties}
    >
      <span className="frame block" data-frame={frame} data-glow={glow}>
        <Avatar className="pa-face">
          {image && <AvatarImage src={image} alt="" referrerPolicy="no-referrer" draggable={false} />}
          <AvatarFallback className="pa-initial bg-transparent" delayMs={image ? FALLBACK_DELAY_MS : 0} aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </span>
      {badge ? (
        <span className="pa-badge" aria-hidden="true">
          {badge}
        </span>
      ) : null}
    </span>
  );
  if (online === undefined) return face;
  return (
    <span className="relative flex shrink-0">
      {face}
      {online && (
        <span
          className="online-dot absolute -bottom-0.5 -right-0.5 block"
          style={{ "--dot-ring": `var(--${dotRing})` } as CSSProperties}
          role="img"
          aria-label="Online"
        />
      )}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 3,
  size = 28,
  ring = "card",
  className,
}: {
  people: Face[];
  max?: number;
  size?: number;
  ring?: "card" | "background";
  className?: string;
}) {
  if (people.length === 0) return null;
  return (
    <span className={cn("flex shrink-0", size >= 32 ? "-space-x-2.5" : "-space-x-2", className)}>
      {people.slice(0, max).map((p, i) => (
        <PlayerAvatar
          key={i}
          player={p}
          size={size}
          className={cn("rounded-full ring-2", ring === "card" ? "ring-card" : "ring-background")}
        />
      ))}
    </span>
  );
}
