import { AnimatePresence, motion } from "motion/react";
import { BusIcon, CrownSimpleIcon } from "@phosphor-icons/react";
import type { Shown } from "./show";

// What floats over the board for a moment, in the middle of the open part of the screen: the dice as they land,
// and a card as it's drawn.

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

function Die({ n, i, speed }: { n: number; i: number; speed?: boolean }) {
  return (
    <motion.div
      className={speed ? "ll-die ll-die-speed" : "ll-die"}
      initial={{ rotate: -200 + i * 90, scale: 0.4, y: -40, opacity: 0 }}
      animate={{ rotate: 0, scale: 1, y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 16, delay: i * 0.06 }}
      role="img"
      aria-label={speed ? (n <= 3 ? `Speed die ${n}` : n === 6 ? "Speed die: bus" : "Speed die: the boss") : `${n}`}
    >
      {speed && n > 3 ? (
        n === 6 ? <BusIcon weight="fill" size={30} /> : <CrownSimpleIcon weight="fill" size={30} />
      ) : (
        PIPS[n].map(([r, c], k) => <span key={k} className="ll-pip" style={{ gridRow: r + 1, gridColumn: c + 1 }} />)
      )}
    </motion.div>
  );
}

export function Overlays({ shown, top, bottom }: { shown: Shown; top: number; bottom: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 z-10 px-6" style={{ top, bottom }}>
      <div className="absolute inset-x-0 top-3 flex justify-center">
        <AnimatePresence>
          {shown.dice && (
            <motion.div key={`d${shown.dice.key}`} className="flex gap-3" exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.25 }}>
              {shown.dice.dice.map((n, i) => (
                <Die key={i} n={n} i={i} />
              ))}
              {shown.dice.speed !== undefined && <Die n={shown.dice.speed} i={2} speed />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="absolute inset-0 grid place-items-center px-6">
      <AnimatePresence>
        {shown.card && (
          <motion.div
            key={`c${shown.card.key}`}
            className="ll-card w-full max-w-72"
            data-deck={shown.card.deck}
            initial={{ rotateY: 90, scale: 0.8, opacity: 0 }}
            animate={{ rotateY: 0, scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            role="status"
          >
            <div className="font-display text-heading">{shown.card.deck === "chance" ? "Fortune" : "Treasury"}</div>
            <p className="text-body">{shown.card.text}</p>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
