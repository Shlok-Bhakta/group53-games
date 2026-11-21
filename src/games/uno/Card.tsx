import type { CSSProperties, ReactNode } from "react";
import {
  ArrowsCounterClockwiseIcon,
  BroomIcon,
  ProhibitIcon,
  ProhibitInsetIcon,
  SparkleIcon,
  SpinnerBallIcon,
} from "@phosphor-icons/react";
import { cardName, colorOf, drawOf, faceOf, type Card, type Face } from "../../../convex/uno/cards";
import { cn } from "@/lib/utils";

function glyph(face: Face, size: number): ReactNode {
  switch (face) {
    case "S":
      return <ProhibitIcon size={size} weight="bold" />;
    case "R":
      return <ArrowsCounterClockwiseIcon size={size} weight="bold" />;
    case "SA":
      return <ProhibitInsetIcon size={size} weight="fill" />;
    case "DA":
      return <BroomIcon size={size} weight="fill" />;
    case "W":
      return <SparkleIcon size={size} weight="fill" />;
    case "WC":
      return <SpinnerBallIcon size={size} weight="fill" />;
    case "D2":
      return "+2";
    case "D4":
    case "W4":
    case "WR4":
      return "+4";
    case "W6":
      return "+6";
    case "W10":
      return "+10";
    default:
      return <span className={face === "6" || face === "9" ? "underline decoration-2 underline-offset-2" : undefined}>{face}</span>;
  }
}

const corner = (card: Card) => (/^[0-9]$/.test(faceOf(card)) ? faceOf(card) : drawOf(card) ? `+${drawOf(card)}` : null);

export function UnoCard({
  card,
  width,
  chosen,
  dim,
  className,
  style,
}: {
  card?: Card;
  width: number;
  chosen?: string;
  dim?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const vars = { "--w": `${width}px`, ...style } as CSSProperties;
  if (!card)
    return <span data-slot="playing-card" className={cn("playing-card playing-card-back", className)} style={vars} aria-hidden="true" />;
  const face = faceOf(card);
  const icon = Math.round(width * 0.5);
  const small = corner(card);
  return (
    <span
      data-slot="playing-card"
      data-uno={colorOf(card)}
      data-card={card}
      data-dim={dim ? "true" : undefined}
      className={cn("playing-card playing-card-uno font-display", className)}
      style={vars}
      role="img"
      aria-label={cardName(card)}
    >
      {width >= 40 && small && <span className="playing-card-corner">{small}</span>}
      <span className="playing-card-glyph">{glyph(face, icon)}</span>
      {face === "WR4" && width >= 40 && (
        <span className="absolute right-[9%] bottom-[7%]">
          <ArrowsCounterClockwiseIcon size={Math.round(width * 0.22)} weight="bold" />
        </span>
      )}
      {chosen && (
        <span
          className="absolute inset-x-[22%] bottom-[9%] h-[9%] rounded-full shadow-sm"
          style={{ background: `var(--color-uno-${chosen})` }}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
