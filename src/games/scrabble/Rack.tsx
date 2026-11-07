import type { PointerEvent as ReactPointerEvent, Ref } from "react";
import { motion } from "motion/react";
import type { Tile } from "../../../convex/scrabble/engine";
import { cn } from "@/lib/utils";
import { LetterTile } from "./Tile";

// My tiles, in my order. Tap one to pick it up, drag it onto the board or to another place in the rack.
export function Rack({
  ref,
  tiles,
  size,
  selected,
  swapping,
  dragging,
  slot,
  hop,
  onDown,
}: {
  ref: Ref<HTMLDivElement>;
  tiles: Tile[];
  size: number;
  selected: number | null;
  swapping: number[] | null;
  dragging: number | null;
  slot: number | null;
  hop: number;
  onDown: (id: number, e: ReactPointerEvent) => void;
}) {
  // While a tile is dragged over the rack, the others part to show where it'll go.
  const shown = tiles.filter((t) => t.id !== dragging);
  const items: (Tile | null)[] = [...shown];
  if (slot !== null) items.splice(Math.min(slot, items.length), 0, null);
  return (
    <div ref={ref} className="grid h-[62px] items-center gap-1.5 rounded-lg bg-muted/60 px-2" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }} aria-label="Your tiles">
      {items.map((t, i) =>
        t === null ? (
          <span key="slot" className="aspect-square rounded-sm border-2 border-dashed border-primary/50" />
        ) : (
          <motion.button
            key={t.id}
            layout
            type="button"
            initial={{ scale: 0.4, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: "spring", bounce: 0.35, duration: 0.4, delay: i * 0.03 }}
            aria-label={t.letter === "?" ? "Blank tile" : `Tile ${t.letter}`}
            aria-pressed={swapping ? swapping.includes(t.id) : selected === t.id}
            className={cn("grid touch-none place-items-center", (selected === t.id || swapping?.includes(t.id)) && "-translate-y-1.5")}
            style={{ transition: "translate 120ms ease-out" }}
            onPointerDown={(e) => onDown(t.id, e)}
          >
            {/* Shuffling makes every tile hop; a picked-up tile jiggles until you put it somewhere. */}
            <motion.span key={hop} className="grid w-full place-items-center" animate={hop ? { y: [0, -14, 0] } : undefined} transition={{ duration: 0.35, delay: i * 0.035, ease: "easeOut" }}>
              <motion.span
                className="grid w-full place-items-center"
                animate={selected === t.id ? { rotate: [0, -5, 5, -4, 4, 0] } : { rotate: 0 }}
                transition={selected === t.id ? { duration: 0.5, repeat: Infinity, repeatDelay: 0.5 } : { duration: 0.15 }}
              >
                <LetterTile
                  letter={t.letter}
                  size={46}
                  className="w-full max-w-[46px]"
                  style={{
                    height: "auto",
                    aspectRatio: "1",
                    // Keeps the tile's own edge and shadow, and adds the ring.
                    boxShadow:
                      selected === t.id ? "inset 0 -3px 0 #cdb07c, 0 0 0 3px var(--primary), 0 8px 14px rgb(0 0 0 / 0.28)"
                      : swapping?.includes(t.id) ? "inset 0 -3px 0 #cdb07c, 0 0 0 3px var(--tile-hit)"
                      : undefined,
                  }}
                />
              </motion.span>
            </motion.span>
          </motion.button>
        ),
      )}
      {pad(size - items.length)}
    </div>
  );
}

// Empty places in the rack keep the tiles from stretching.
const pad = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => <span key={`pad${i}`} />);
