import type { CSSProperties, ReactNode } from "react";
import {
  ArrowsCounterClockwiseIcon,
  BroomIcon,
  ProhibitIcon,
  ProhibitInsetIcon,
  SparkleIcon,
  SpinnerBallIcon,
} from "@phosphor-icons/react";
import { cardName, colorOf, faceOf, type Card, type Face } from "../../../convex/uno/cards";
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

const shrink = (face: Face) => (face === "W10" ? 0.72 : face.length > 1 && face !== "SA" && face !== "DA" && face !== "WC" ? 0.86 : 1);

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
    return (
      <span
        data-slot="playing-card"
        className={cn("playing-card playing-card-uno playing-card-uno-back font-display", className)}
        style={vars}
        aria-hidden="true"
      >
        {width >= 24 && <span className="playing-card-oval" />}
        {width >= 40 && <span className="playing-card-uno-face">53</span>}
      </span>
    );
  const face = faceOf(card);
  const big = Math.round(width * 0.5 * shrink(face));
  return (
    <span
      data-slot="playing-card"
      data-uno={colorOf(card)}
      data-chosen={chosen}
      data-card={card}
      data-dim={dim ? "true" : undefined}
      className={cn("playing-card playing-card-uno font-display", className)}
      style={vars}
      role="img"
      aria-label={cardName(card)}
    >
      <span className="playing-card-oval" />
      <span className="playing-card-uno-face" style={{ fontSize: big }}>
        {glyph(face, big)}
      </span>
      {width >= 44 && (
        <>
          <span className="playing-card-uno-index">{glyph(face, Math.round(width * 0.17))}</span>
          <span className="playing-card-uno-index" data-flip>
            {glyph(face, Math.round(width * 0.17))}
          </span>
        </>
      )}
    </span>
  );
}
