import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type FrameStyle = { frame?: string; frameColor?: string; glow?: boolean };
// Anything with a face: a seat at a game, a crew member, a profile.
export type Face = FrameStyle & { name: string; image?: string };

type Props = FrameStyle & {
  // The person, whole: their name, picture and frame. Their glow and badge only show when asked for.
  player?: Face;
  name?: string;
  image?: string;
  badge?: string;
  size?: number;
  // A steady green dot in the corner while they've got the app open. `dotRing` is what the avatar sits on.
  online?: boolean;
  dotRing?: "card" | "background";
  // A ring in their seat's color, round whatever it sits in (golf's turn bar and scorecard).
  seat?: string;
  className?: string;
};

export function PlayerAvatar({ player, name = player?.name ?? "", image = player?.image, frame = player?.frame ?? "none", frameColor = player?.frameColor, glow = false, badge, size = 48, online, dotRing = "card", seat, className }: Props) {
  const face = (
    <span className={cn("pa", className)} data-seat={seat ? "" : undefined} style={{ "--s": `${size}px`, "--frame-color": frameColor, "--seat": seat } as CSSProperties}>
      <span className="frame block" data-frame={frame} data-glow={glow}>
        <span className="pa-face">
          {image ? (
            <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} />
          ) : (
            <span className="pa-initial" aria-hidden="true">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
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
      {online && <span className="online-dot absolute -bottom-0.5 -right-0.5 block" style={{ "--dot-ring": `var(--${dotRing})` } as CSSProperties} role="img" aria-label="Online" />}
    </span>
  );
}

// A few faces overlapping, for "who's here" and games with several people in them. `ring` is what they sit on.
export function AvatarStack({ people, max = 3, size = 28, ring = "card", className }: { people: Face[]; max?: number; size?: number; ring?: "card" | "background"; className?: string }) {
  if (people.length === 0) return null;
  return (
    <span className={cn("flex shrink-0", size >= 32 ? "-space-x-2.5" : "-space-x-2", className)}>
      {people.slice(0, max).map((p, i) => (
        <PlayerAvatar key={i} player={p} size={size} className={cn("rounded-full ring-2", ring === "card" ? "ring-card" : "ring-background")} />
      ))}
    </span>
  );
}
