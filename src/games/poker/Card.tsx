import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const PIP: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
const RANK_NAME: Record<string, string> = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "10" };
const shownRank = (r: string) => (r === "T" ? "10" : r);

export const cardName = (card: string) => `${RANK_NAME[card[0]] ?? card[0]} of ${SUIT_NAME[card[1]]}`;

// One playing card, face up, face down (`card` left out, in the holder's color) or an empty slot on the board.
export function PlayingCard({ card, width, seat, slot, className, style }: { card?: string; width: number; seat?: string; slot?: boolean; className?: string; style?: CSSProperties }) {
  const vars = { "--w": `${width}px`, ...(seat ? { "--seat": seat } : {}), ...style } as CSSProperties;
  if (!card) return <span className={cn("pcard", slot ? "pcard-slot" : "pcard-back", className)} style={vars} aria-hidden="true" />;
  return (
    <span className={cn("pcard", className)} data-suit={card[1]} data-card={card} style={vars} role="img" aria-label={cardName(card)}>
      <span className="pcard-rank">{shownRank(card[0])}</span>
      {width >= 34 && <span className="pcard-pip">{PIP[card[1]]}</span>}
      <span className="pcard-big">{PIP[card[1]]}</span>
    </span>
  );
}

// A poker chip in a seat's color.
export function Chip({ width = 14, seat }: { width?: number; seat?: string }) {
  return <span className="pchip" style={{ "--w": `${width}px`, ...(seat ? { "--seat": seat } : {}) } as CSSProperties} aria-hidden="true" />;
}
