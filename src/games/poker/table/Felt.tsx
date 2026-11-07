import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import type { MatchView } from "../../../../convex/matches";
import { PlayingCard, PokerChip } from "@/components/ui/playing-card";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";
import { PACE, type Show } from "../show";
import { DECK_W, FLIGHT, SPRING, toward } from "./motion";

// The middle of the table: the pot's pile of chips, the deck and the board.

// The chips gathered so far, a few for each seat that's put something in, in their colors.
export function Pile({ show, match }: { show: Show; match: MatchView }) {
  const bb = show.state.bb || 1;
  const pile = show.paid.flatMap((paid, seat) => {
    const gathered = paid - show.bets[seat];
    if (gathered <= 0) return [];
    const count = Math.min(3, 1 + Math.floor(gathered / (bb * 4)));
    return Array.from({ length: count }, (_, k) => ({ key: `${seat}:${k}`, color: seatColor(match.players[seat]) }));
  });
  return (
    <span data-pile className="relative h-6 w-8" aria-hidden="true">
      {pile.slice(0, 9).map((c, i) => (
        <motion.span
          key={`${show.state.hand}:${c.key}`}
          className="absolute"
          style={{ left: 4 + ((i * 11) % 22), top: 7 - (i % 3) * 3 }}
          initial={{ scale: 1.5, opacity: 0.3 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.22 * PACE, ease: SPRING }}
        >
          <PokerChip width={16} seat={c.color} />
        </motion.span>
      ))}
    </span>
  );
}

// A little stack of backs, which gives a shake when it's shuffled, and where every card flies from and to.
export function Deck({ hand, shuffling }: { hand: number; shuffling: boolean }) {
  return (
    <motion.span
      key={shuffling ? `shuffle${hand}` : "deck"}
      data-deck
      aria-hidden="true"
      className="relative mr-1.5 h-[39px] w-7 justify-self-end"
      animate={shuffling ? { rotate: [0, -6, 5, 0] } : undefined}
      transition={{ duration: 0.3 * PACE }}
    >
      {[-4, -2, 0].map((x) => (
        <span key={x} className="absolute block" style={{ left: x, top: -x / 2 }}>
          <PlayingCard width={DECK_W} />
        </span>
      ))}
    </motion.span>
  );
}

export function Board({ show, rung }: { show: Show; rung: string[] }) {
  const s = show.state;
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(64);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const fit = () => setWidth(Math.min(64, Math.floor((el.clientWidth - 20) / 5)));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [s.variant]);
  // No flights for what's already out when the table first appears.
  const opened = useRef(false);
  useEffect(() => {
    opened.current = true;
  }, []);
  if (s.variant === "draw") return <div className="h-3" />;
  const ending = !!show.best;
  return (
    <div ref={row} role="group" aria-label="Board" className="relative mt-1.5 flex justify-center gap-[5px]">
      {Array.from({ length: 5 }, (_, i) => {
        const card = show.board[i];
        const best = !!card && rung.includes(card);
        return <BoardCard key={card ? `${s.hand}${card}` : `slot${i}`} card={card} width={width} best={best} lift={ending && best} dim={ending && !best} fly={opened.current} />;
      })}
    </div>
  );
}

function BoardCard({ card, width, best, lift, dim, fly }: { card?: string; width: number; best: boolean; lift: boolean; dim: boolean; fly: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
  useLayoutEffect(() => {
    if (!card || !fly || still || !ref.current) return;
    const from = toward(ref.current, "[data-deck]");
    if (!from) return;
    const flight = animate(ref.current, { x: [from.x, 0], y: [from.y, 0], scale: [0.45, 1], rotateY: [90, 0], opacity: [0.6, 1] }, { duration: 0.4 * PACE, ease: FLIGHT, scale: { duration: 0.4 * PACE, ease: SPRING } });
    return () => flight.cancel();
    // Only ever on arriving.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span ref={ref} className="block shrink-0">
      {card ? <PlayingCard card={card} width={width} best={best} className={cn(dim && "opacity-40", lift && "-translate-y-[5px]")} /> : <PlayingCard slot width={width} />}
    </span>
  );
}
