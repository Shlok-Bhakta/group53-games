import { motion } from "motion/react";
import { TimerIcon } from "@phosphor-icons/react";
import type { ModeKey } from "../../../convex/modes";
import { LetterTile, PREMIUM_STYLE } from "./Tile";

// The Scrabble card's art: SCRABBLE drops in across, then WORDS down through its R. About a second, once.
const ACROSS = "SCRABBLE";
const DOWN = "WORDS"; // the R is DOWN[2]
const COL = 2;
const ROW = 2;

export function ScrabbleBanner() {
  const tiles = [
    ...[...ACROSS].map((l, i) => ({ l, x: i, y: ROW, d: i * 0.06 })),
    ...[...DOWN].map((l, i) => ({ l, x: COL, y: i, d: 0.55 + i * 0.07 })).filter((t) => t.y !== ROW),
  ];
  return (
    <div className="relative mx-auto grid w-full max-w-[320px] grid-cols-8 grid-rows-5 gap-1" aria-label="Scrabble" role="img">
      {tiles.map((t) => (
        <motion.span
          key={`${t.x},${t.y}`}
          style={{ gridColumn: t.x + 1, gridRow: t.y + 1 }}
          className="grid place-items-center"
          initial={{ opacity: 0, y: -14, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", bounce: 0.35, duration: 0.45, delay: t.d }}
        >
          <LetterTile letter={t.l} size={34} />
        </motion.span>
      ))}
    </div>
  );
}

// A corner of the board with a word on it; the live mode gets a timer that ticks in once.
const MINI = ["T..d.", ".D...", "..D..", "d..*.", "....."];
export function ScrabbleModeArt({ mode }: { mode: ModeKey }) {
  const live = mode === "scrabble:live";
  const word = live ? "GO" : "ZEN";
  return (
    <span className="relative block size-20" aria-hidden="true">
      <span className="grid size-full grid-cols-5 grid-rows-5 gap-px overflow-hidden rounded-sm bg-border">
        {MINI.flatMap((row, y) =>
          [...row].map((c, x) => {
            const p = PREMIUM_STYLE[c as keyof typeof PREMIUM_STYLE];
            return <span key={`${x}${y}`} style={{ background: p?.bg ?? "var(--muted)" }} />;
          }),
        )}
      </span>
      <span className="absolute inset-x-0 top-[58%] flex justify-center gap-0.5">
        {[...word].map((l, i) => (
          <motion.span key={i} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", bounce: 0.4, duration: 0.4, delay: 0.15 + i * 0.07 }}>
            <LetterTile letter={l} size={22} />
          </motion.span>
        ))}
      </span>
      {live && (
        <motion.span
          className="absolute -right-2 -top-1 grid size-8 place-items-center rounded-full bg-[var(--tile-yellow)] text-[var(--tile-yellow-ink)] shadow"
          initial={{ scale: 0.6, rotate: -30, opacity: 0 }}
          animate={{ scale: [0.6, 1.15, 1], rotate: [-30, 12, 0], opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <TimerIcon size={18} weight="fill" />
        </motion.span>
      )}
    </span>
  );
}
