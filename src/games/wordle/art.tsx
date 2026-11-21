import { motion } from "motion/react";
import { Tiles } from "@/Tiles";
import { MARK_BG } from "./parts";

const SHARE = ["01002", "02120", "22202", "22222"];

export function WordleBanner() {
  return (
    <div className="flex h-[150px] items-center justify-center">
      <Tiles word="WORDLE" states={["green", "yellow", "gray", "green", "hit", "green"]} size="lg" flip label="PvP Wordle" />
    </div>
  );
}

export function WordleModeArt() {
  return (
    <span className="grid size-20 grid-cols-5 content-center gap-[3px] px-1" aria-hidden="true">
      {SHARE.flatMap((row, y) =>
        [...row].map((m, x) => (
          <motion.span
            key={`${x}${y}`}
            className="aspect-square rounded-xs"
            style={{ background: MARK_BG[Number(m)] }}
            initial={{ rotateX: 90 }}
            animate={{ rotateX: 0 }}
            transition={{ duration: 0.3, delay: 0.1 + y * 0.18 + x * 0.04 }}
          />
        )),
      )}
    </span>
  );
}
