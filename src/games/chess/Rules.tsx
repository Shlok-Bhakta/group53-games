import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpenTextIcon, CaretDownIcon } from "@phosphor-icons/react";
import type { ModeKey } from "../../../convex/modes";
import { cn } from "@/lib/utils";

const RULES: Record<ModeKey, string[]> = {
  "chess:classic": [
    "Normal chess, one move at a time.",
    "We ping you when it's your move, and again every 8 hours if you forget.",
    "Offer a draw or resign from under the board.",
  ],
  "chess:four": [
    "Red, blue, yellow and green take turns clockwise. Your army is always at the bottom of your screen.",
    "Captures score points: pawn 1, knight 3, bishop or rook 5, queen 9. Queens made by promotion are worth 1.",
    "Check two kings with one move for +5, all three for +20.",
    "Checkmate someone for +20. If you have no legal move and aren't in check, you're out but get +20.",
    "Knocked-out armies turn grey. Their pieces still block, and taking them scores nothing.",
    "Pawns promote to a queen on the middle line.",
    "It ends when one player is left, or after 50 quiet rounds (+10 each to everyone still in). Most points wins.",
    "Sit on your move for two days and you time out.",
  ],
  "chess:realtime": [
    "No turns. Move any piece whenever it's ready.",
    "Pieces travel 1 square a second, then rest for 5 seconds.",
    "Collide with an enemy piece and whoever moved first wins.",
    "Drag a resting piece to premove; it goes the moment it's ready. Tap it to cancel.",
    "Take the king to win. No checks, no checkmate.",
  ],
  "chess:realtime4": [
    "Four armies, no turns: everyone moves at once on the cross-shaped board.",
    "Pieces travel 1 square a second, then rest for 5 seconds. First mover wins a collision.",
    "Lose your king and your whole army turns to grey stone where it stands.",
    "Last king standing wins. Everyone else places by how long they lasted.",
    "No castling. Pawns promote on the middle line.",
  ],
};

// The rules for a mode, folded away once you've played it. Height animates on a bare wrapper (padding
// lives inside it) so it closes all the way down instead of snapping shut at the end.
export function Rules({ mode, defaultOpen }: { mode: ModeKey; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="-mx-1 flex min-h-12 w-[calc(100%+0.5rem)] touch-manipulation items-center gap-2.5 rounded-xl px-1 text-left font-semibold active:bg-muted"
      >
        <BookOpenTextIcon size={20} weight="fill" className="text-primary" />
        <span className="flex-1">How to play</span>
        <CaretDownIcon weight="bold" className={cn("text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rules"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.25, 0.8, 0.25, 1] }}
            className="overflow-hidden"
          >
            <ol className="flex flex-col gap-2.5 pb-1 pt-2">
              {RULES[mode].map((rule, i) => (
                <li key={i} className="flex gap-3 text-[0.95rem] leading-relaxed">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary/12 text-xs font-bold text-primary">{i + 1}</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
