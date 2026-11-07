import type { Ref } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { LetterTile } from "./Tile";

// The tile under your finger while you drag it. `useTileDrag` moves it through `ref`, straight in the DOM.
export function DragGhost({ ref, letter, blank }: { ref: Ref<HTMLDivElement>; letter: string; blank: boolean }) {
  return createPortal(
    <div ref={ref} className="pointer-events-none fixed left-0 top-0 z-50 drop-shadow-xl" style={{ transform: "translate3d(-200px,-200px,0)" }}>
      {/* A held tile jiggles in your fingers. */}
      <motion.span className="block" initial={{ scale: 1 }} animate={{ scale: 1.12, rotate: [0, -4, 4, -3, 3, 0] }} transition={{ scale: { type: "spring", bounce: 0.5, duration: 0.3 }, rotate: { duration: 0.5, repeat: Infinity, repeatDelay: 0.4 } }}>
        <LetterTile letter={letter} blank={blank} size={52} />
      </motion.span>
    </div>,
    document.body,
  );
}
