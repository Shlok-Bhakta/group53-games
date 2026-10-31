import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"

// A playing card ("As", "Td", "7c": rank then suit), drawn as a physical card the same in every theme
// (`.playing-card` in style.css). Face up, face down in a seat's color (`card` left out), or an empty slot.

// U+FE0E asks for the text glyph, so iOS never swaps in an emoji heart.
const PIP: Record<string, string> = { s: "♠\uFE0E", h: "♥\uFE0E", d: "♦\uFE0E", c: "♣\uFE0E" }
const SUIT_NAME: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" }
const RANK_NAME: Record<string, string> = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "10" }

function cardName(card: string) {
  return `${RANK_NAME[card[0]] ?? card[0]} of ${SUIT_NAME[card[1]]}`
}

function PlayingCard({
  card,
  width,
  seat,
  slot,
  className,
  style,
}: {
  card?: string
  width: number
  seat?: string
  slot?: boolean
  className?: string
  style?: CSSProperties
}) {
  const vars = { "--w": `${width}px`, ...(seat ? { "--seat": seat } : {}), ...style } as CSSProperties
  if (!card) {
    return <span data-slot="playing-card" className={cn("playing-card", slot ? "playing-card-slot" : "playing-card-back", className)} style={vars} aria-hidden="true" />
  }
  return (
    <span data-slot="playing-card" className={cn("playing-card", className)} data-suit={card[1]} data-card={card} style={vars} role="img" aria-label={cardName(card)}>
      <span className="playing-card-rank">{card[0] === "T" ? "10" : card[0]}</span>
      {width >= 34 && <span className="playing-card-pip">{PIP[card[1]]}</span>}
      <span className="playing-card-big">{PIP[card[1]]}</span>
    </span>
  )
}

// A poker chip in a seat's color.
function PokerChip({ width = 14, seat }: { width?: number; seat?: string }) {
  return <span data-slot="poker-chip" className="poker-chip" style={{ "--w": `${width}px`, ...(seat ? { "--seat": seat } : {}) } as CSSProperties} aria-hidden="true" />
}

export { PlayingCard, PokerChip, cardName }
