import { motion } from "motion/react";
import type { ModeKey } from "../../../convex/modes";
import { UnoCard } from "./Card";

const FAN = ["r7", "yS", "gR", "bD2", "wW4"];

export function UnoBanner() {
  return (
    <div className="relative mx-auto flex h-[150px] w-full max-w-[320px] items-end justify-center" aria-label="Uno" role="img">
      {FAN.map((card, i) => (
        <motion.span
          key={card}
          className="absolute bottom-2"
          style={{ transformOrigin: "50% 120%" }}
          initial={{ opacity: 0, y: -40, rotate: 0, x: 0 }}
          animate={{ opacity: 1, y: Math.abs(i - 2) * 6, rotate: (i - 2) * 12, x: (i - 2) * 38 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.5, delay: i * 0.09 }}
        >
          <UnoCard card={card} width={70} />
        </motion.span>
      ))}
    </div>
  );
}

const HANDS: Record<string, string[]> = {
  "uno:classic": ["r5", "bR", "wW"],
  "uno:nomercy": ["gD4", "wW6", "wW10"],
};

export function UnoModeArt({ mode }: { mode: ModeKey }) {
  const cards = HANDS[mode] ?? HANDS["uno:classic"];
  return (
    <span className="relative block size-20" aria-hidden="true">
      {cards.map((card, i) => (
        <motion.span
          key={card}
          className="absolute bottom-1 left-1/2"
          style={{ transformOrigin: "50% 130%", marginLeft: -17 }}
          initial={{ opacity: 0, y: -12, rotate: 0 }}
          animate={{ opacity: 1, y: 0, rotate: (i - 1) * 16, x: (i - 1) * 14 }}
          transition={{ type: "spring", bounce: 0.35, duration: 0.45, delay: 0.1 + i * 0.07 }}
        >
          <UnoCard card={card} width={34} />
        </motion.span>
      ))}
    </span>
  );
}
