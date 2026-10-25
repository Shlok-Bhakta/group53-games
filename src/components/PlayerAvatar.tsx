import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type FrameStyle = { frame?: string; frameColor?: string; glow?: boolean };

type Props = FrameStyle & {
  name: string;
  image?: string;
  badge?: string;
  size?: number;
  className?: string;
};

export function PlayerAvatar({ name, image, frame = "none", frameColor, glow = false, badge, size = 48, className }: Props) {
  return (
    <span className={cn("pa", className)} style={{ "--s": `${size}px`, "--frame-color": frameColor } as CSSProperties}>
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
}
