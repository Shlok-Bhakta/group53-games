import type { Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretLeftIcon, CornersInIcon, CornersOutIcon, FlagPennantIcon, GolfIcon, ListIcon, XIcon } from "@phosphor-icons/react";
import { BAG_SIZE, type Course, type Power } from "../../../convex/golf/engine";
import type { Ball } from "../../../convex/golf/world";
import { Button } from "@/components/ui/button";
import { AvatarStack, type Face } from "@/components/PlayerAvatar";
import { FloatButton, FloatingTopBar, FloatPill } from "@/components/game/floating";
import { cn } from "@/lib/utils";
import { ITEMS } from "./items";
import type { Target } from "./useGolfLoop";
import type { Round } from "./GolfWorld";

// What floats over a golf world: the bar on top, the hint while placing a targeted item, and the dock with
// the bag.

export type Hud = { ready: boolean; mode: Ball["mode"] | null; bag: Power[]; armed: Power | null; shot: Power | null; holes: number; strokes: number; status: string | null; canShoot: boolean; slow: boolean };

// Back, the course and who's on it, and my count: strokes on a hole, holes sunk in the open world.
export function TopBar({ ref, course, hole, others, hud, onBack }: { ref: Ref<HTMLDivElement>; course: Course; hole?: { number: number }; others: Face[]; hud: Hud; onBack: () => void }) {
  return (
    <FloatingTopBar ref={ref}>
      <FloatButton aria-label="Back" onClick={onBack}>
        <CaretLeftIcon size={22} weight="bold" />
      </FloatButton>
      <FloatPill className="flex-1 py-1 pl-4 pr-1.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-callout leading-tight">{course.name}</span>
          <span className="block truncate text-caption text-muted-foreground">
            {hole ? `Hole ${hole.number}, par ${course.par}` : others.length === 0 ? "Just you" : others.length === 1 ? `${others[0].name} is here` : `${others.length + 1} here`}
          </span>
        </span>
        {/* Faces only: frames don't fit in the pill. */}
        <AvatarStack people={others.map((p) => ({ name: p.name, image: p.image }))} />
        {hole ? (
          <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full bg-primary px-3 font-display text-callout text-primary-foreground" aria-label={`${hud.strokes} strokes`}>
            {hud.strokes}
          </span>
        ) : (
          <span className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-primary px-3 font-display text-callout text-primary-foreground" aria-label={`${hud.holes} sunk`}>
            <FlagPennantIcon weight="fill" size={16} />
            {hud.holes}
          </span>
        )}
      </FloatPill>
    </FloatingTopBar>
  );
}

// A game's top bar: back, the hole with whose turn it is (the game says what, `round.bar`), my strokes, and the
// menu with the card and the rules.
export function RoundBar({ ref, course, round, hud, onBack }: { ref: Ref<HTMLDivElement>; course: Course; round: Round; hud: Hud; onBack: () => void }) {
  return (
    <FloatingTopBar ref={ref}>
      <FloatButton aria-label="Back" onClick={onBack}>
        <CaretLeftIcon size={22} weight="bold" />
      </FloatButton>
      <FloatPill onClick={round.onMenu} aria-label="Scorecard" className="flex-1 py-1 pl-1.5 pr-1.5">
        {round.bar}
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary font-display text-callout tabular-nums leading-none text-primary-foreground" aria-label={`Hole ${round.number}, par ${course.par}, ${hud.strokes} strokes`}>
          {hud.strokes}
        </span>
      </FloatPill>
      <FloatButton aria-label="Menu" onClick={round.onMenu}>
        <ListIcon size={22} weight="bold" />
      </FloatButton>
    </FloatingTopBar>
  );
}

// Under the top bar while a targeted item waits for a tap on the map.
export function TargetHint({ target, onCancel }: { target: Target | null; onCancel: () => void }) {
  return (
    <AnimatePresence>
      {target && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ type: "spring", bounce: 0, duration: 0.3 }}
          className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+92px)] z-20 flex justify-center"
        >
          <FloatPill className="py-1 pl-4 pr-1 font-display text-callout">
            {ITEMS[target.kind].hint}
            {/* 44px to tap, drawn 36px so it sits inside the pill. */}
            <button type="button" aria-label="Cancel" onClick={onCancel} className="-m-1 grid size-11 place-items-center active:scale-[0.94]">
              <span className="grid size-9 place-items-center rounded-full bg-muted">
                <XIcon weight="bold" />
              </span>
            </button>
          </FloatPill>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// The bag, what's happening to my ball, and the buttons: Jump or Brake while one's in play, otherwise the
// whole map and back to a tee.
export function Dock({
  ref,
  hud,
  target,
  hole,
  game,
  myTurn,
  big,
  overview,
  onItem,
  onRolling,
  onOverview,
  onReset,
}: {
  ref: Ref<HTMLDivElement>;
  hud: Hud;
  target: Target | null;
  hole: boolean;
  game: boolean; // in a game: no starting again
  myTurn: boolean;
  big: boolean;
  overview: boolean;
  onItem: (i: number) => void;
  onRolling: () => void;
  onOverview: () => void;
  onReset: () => void;
}) {
  return (
    <div ref={ref} className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
      <div className="flex gap-2">
        {Array.from({ length: BAG_SIZE }, (_, i) => {
          const p = hud.bag[i];
          const item = p ? ITEMS[p] : null;
          const Ico = item?.icon;
          const on = target?.i === i || (p && hud.armed === p && i === hud.bag.indexOf(p));
          return (
            <FloatButton
              key={`${i}-${p ?? "empty"}`}
              disabled={!p || hud.mode !== "aim" || !myTurn}
              onClick={() => onItem(i)}
              aria-label={item ? `Use ${item.name}` : "Empty slot"}
              className={cn("size-14 rounded-lg disabled:opacity-60", !p && "bg-card/50 shadow-none", on && "bg-primary text-primary-foreground")}
            >
              {Ico && (
                <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.4, duration: 0.4 }}>
                  <Ico size={26} weight={on ? "fill" : "bold"} />
                </motion.span>
              )}
            </FloatButton>
          );
        })}
      </div>
      <span className="min-w-0 flex-1 text-center font-display text-footnote text-foreground [text-shadow:0_1px_3px_var(--background)]" aria-live="polite">
        {hud.slow && <span className="block truncate">Slow connection</span>}
        {hud.status && <span className="block truncate">{hud.status}</span>}
        {hud.armed && <span className="block truncate">{ITEMS[hud.armed].name} next shot</span>}
      </span>
      {hud.mode === "roll" && (hud.shot === "brake" || hud.shot === "jump") ? (
        // On the finger going down, not up: a rolling ball won't wait for a tap to finish.
        <Button size="xl" onPointerDown={onRolling} className="border-0 px-5 font-display text-callout shadow-md">
          {hud.shot === "jump" ? "Jump" : "Brake"}
        </Button>
      ) : (
        <>
          {big && (
            <FloatButton aria-label={overview ? "Follow my ball" : "See the whole map"} onClick={onOverview} className="size-14">
              {overview ? <CornersInIcon size={24} weight="bold" /> : <CornersOutIcon size={24} weight="bold" />}
            </FloatButton>
          )}
          {!game && (
            <FloatButton aria-label={hole ? "Start the hole again" : "Back to a tee"} disabled={hud.mode !== "aim"} onClick={onReset} className="size-14 disabled:opacity-60">
              <GolfIcon size={24} weight="bold" />
            </FloatButton>
          )}
        </>
      )}
    </div>
  );
}
