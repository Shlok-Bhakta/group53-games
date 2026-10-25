import { motion } from "motion/react";

// The Chess card's art: two ranks drop in, then a knight hops in and takes a pawn. About a second, once.
const BACK = ["R", "N", "B", "Q", "K", "B", "N", "R"] as const;
const KNIGHT_FROM = 6; // g1
const VICTIM = 4; // e2
const HOP_AT = 0.62;
const HOP = 0.34;

export function ChessBanner() {
  return (
    <div className="relative mx-auto w-full max-w-[320px]" aria-label="Chess" role="img">
      <div className="grid aspect-[4/1] grid-cols-8 grid-rows-2 overflow-hidden rounded-xl shadow-md">
        {Array.from({ length: 16 }, (_, i) => {
          const c = i % 8;
          const r = Math.floor(i / 8);
          const dark = (c + r) % 2 === 1;
          return (
            <motion.span
              key={i}
              className={dark ? "bg-[var(--board-dark)]" : "bg-[var(--board-light)]"}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18, delay: (c + r) * 0.018 }}
            />
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-0">
        {/* Black pawns on the top rank */}
        {Array.from({ length: 8 }, (_, c) => (
          <motion.img
            key={`p${c}`}
            src="/pieces/bP.svg"
            alt=""
            className="absolute top-0 size-[12.5%] aspect-square"
            style={{ left: `${c * 12.5}%`, height: "50%", width: "12.5%" }}
            initial={{ y: -18, opacity: 0 }}
            animate={c === VICTIM ? { y: [-18, 0, 0, 0], opacity: [0, 1, 1, 0], scale: [1, 1, 1, 0.2] } : { y: 0, opacity: 1 }}
            transition={
              c === VICTIM
                ? { duration: HOP_AT + HOP, times: [0, 0.3, (HOP_AT + HOP * 0.85) / (HOP_AT + HOP), 1], delay: 0.08 + c * 0.03 }
                : { type: "spring", stiffness: 520, damping: 26, delay: 0.08 + c * 0.03 }
            }
          />
        ))}
        {/* White back rank on the bottom */}
        {BACK.map((k, c) => {
          const knight = c === KNIGHT_FROM;
          const dx = (VICTIM - KNIGHT_FROM) * 100;
          return (
            <motion.img
              key={`w${c}`}
              src={`/pieces/w${k}.svg`}
              alt=""
              className="absolute bottom-0"
              style={{ left: `${c * 12.5}%`, height: "50%", width: "12.5%" }}
              initial={{ y: 18, opacity: 0 }}
              animate={knight ? { y: [18, 0, 0, "-140%", "-100%"], x: ["0%", "0%", "0%", `${dx / 2}%`, `${dx}%`], opacity: [0, 1, 1, 1, 1] } : { y: 0, opacity: 1 }}
              transition={
                knight
                  ? { duration: HOP_AT + HOP, times: [0, 0.25, HOP_AT / (HOP_AT + HOP), (HOP_AT + HOP / 2) / (HOP_AT + HOP), 1], ease: "easeOut", delay: 0.05 + c * 0.03 }
                  : { type: "spring", stiffness: 520, damping: 26, delay: 0.05 + c * 0.03 }
              }
            />
          );
        })}
        {/* The hit */}
        <motion.span
          className="absolute top-[25%] size-[12.5%] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[var(--tile-hit)]"
          style={{ left: `${VICTIM * 12.5 + 6.25}%`, aspectRatio: "1" }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 0, 1.9], opacity: [0, 1, 0] }}
          transition={{ duration: 0.45, times: [0, 0.05, 1], delay: 0.05 + KNIGHT_FROM * 0.03 + HOP_AT + HOP * 0.85 }}
        />
      </div>
    </div>
  );
}
