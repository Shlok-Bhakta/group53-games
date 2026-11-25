import type { Ref } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import type { Card } from "../../../convex/uno/cards";
import { UnoCard } from "./Card";

export function DragGhost({ ref, card, width }: { ref: Ref<HTMLDivElement>; card: Card; width: number }) {
  return createPortal(
    <div
      ref={ref}
      className="pointer-events-none fixed top-0 left-0 z-50 drop-shadow-xl"
      style={{ transform: "translate3d(-400px,-400px,0)" }}
      data-dragging={card}
      aria-hidden="true"
    >
      <motion.span
        className="block"
        initial={{ scale: 1 }}
        animate={{ scale: 1.1 }}
        transition={{ type: "spring", bounce: 0.5, duration: 0.3 }}
      >
        <UnoCard card={card} width={width} />
      </motion.span>
    </div>,
    document.body,
  );
}
