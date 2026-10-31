import { motion } from "motion/react";
import type { ModeKey } from "../../../convex/modes";
import { PlayingCard } from "./Card";

// The Poker card's art: a royal flush dealt into a fan, one card at a time. About a second, once.
const ROYAL = ["Ts", "Js", "Qs", "Ks", "As"];

export function PokerBanner() {
  return (
    <div className="relative mx-auto flex h-[150px] w-full max-w-[320px] items-end justify-center" aria-label="Poker" role="img">
      {ROYAL.map((card, i) => {
        const angle = (i - 2) * 11;
        return (
          <motion.span
            key={card}
            className="absolute bottom-2"
            style={{ transformOrigin: "50% 120%" }}
            initial={{ opacity: 0, y: -40, rotate: 0, x: 0 }}
            animate={{ opacity: 1, y: Math.abs(i - 2) * 6, rotate: angle, x: (i - 2) * 36 }}
            transition={{ type: "spring", bounce: 0.3, duration: 0.5, delay: i * 0.09 }}
          >
            <PlayingCard card={card} width={72} />
          </motion.span>
        );
      })}
    </div>
  );
}

// Each mode's hand in a little fan: two cards for Hold'em, four for Omaha, Short Deck's 6 and Ace, and a draw
// hand with one card lifted out to swap.
const HANDS: Record<string, string[]> = {
  "poker:holdem": ["Ah", "Ks"],
  "poker:omaha": ["Ac", "Ad", "Kh", "Qs"],
  "poker:short": ["6d", "Ad"],
  "poker:draw": ["9c", "9h", "4s", "9d", "2h"],
};

export function PokerModeArt({ mode }: { mode: ModeKey }) {
  const cards = HANDS[mode] ?? HANDS["poker:holdem"];
  const n = cards.length;
  const spread = n > 3 ? 11 : 16;
  return (
    <span className="relative block size-20" aria-hidden="true">
      {cards.map((card, i) => {
        const mid = (n - 1) / 2;
        const lifted = mode === "poker:draw" && i === 2;
        return (
          <motion.span
            key={card}
            className="absolute bottom-1 left-1/2"
            style={{ transformOrigin: "50% 130%", marginLeft: -17 }}
            initial={{ opacity: 0, y: -12, rotate: 0 }}
            animate={{ opacity: 1, y: lifted ? -12 : 0, rotate: (i - mid) * spread, x: (i - mid) * (n > 3 ? 9 : 14) }}
            transition={{ type: "spring", bounce: 0.35, duration: 0.45, delay: 0.1 + i * 0.07 }}
          >
            <PlayingCard card={card} width={34} />
          </motion.span>
        );
      })}
    </span>
  );
}
