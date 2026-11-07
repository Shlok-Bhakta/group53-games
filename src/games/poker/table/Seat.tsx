import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { isOut } from "../../../../convex/poker/engine";
import { actionLabel } from "../../../../convex/poker/text";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayingCard, PokerChip } from "@/components/ui/playing-card";
import { OnlineDot, useHere } from "@/presence";
import { seatColor } from "@/games/seats";
import type { Player } from "@/games/types";
import { cn } from "@/lib/utils";
import { chips } from "../format";
import { PACE, cardsHeld, type Show } from "../show";
import { DECK_W, FLIGHT, Flying, Roll, SPRING, toward } from "./motion";

// Someone along the rail: their avatar sits on the table's edge, with their cards behind it, on a tile with
// their name and chips.
export function Seat({ player, seat, show, avatar, tight, room, active, rung }: { player: Player; seat: number; show: Show; avatar: number; tight: boolean; room: number; active: boolean; rung: string[] }) {
  const s = show.state;
  const { online } = useHere(player.userId);
  const { dealt, out, folded, allIn, label } = statusOf(show, seat);
  const color = seatColor(player);
  const up = active && show.turn === seat;
  const shown = show.shown[seat];
  const won = show.paying?.find((p) => p.seat === seat);
  const held = dealt ? cardsHeld(s, seat, show.dealtCards) : 0;
  // Shown cards keep to the width of the seat, as far as their corners stay readable.
  const shownW = tight ? 24 : 28;
  const shownStep = Math.max(9, Math.min(shownW - 7, (room - shownW) / Math.max(1, (shown?.length ?? 2) - 1)));
  return (
    <div
      data-seat={player.color}
      data-up={up}
      data-out={out || folded}
      role="group"
      aria-label={`${player.name}, ${chips(show.stacks[seat])} chips${label ? `, ${label}` : ""}`}
      className={cn("relative flex min-w-0 max-w-[92px] flex-1 flex-col items-center transition-[translate] duration-300", up && "-translate-y-1")}
      style={{ "--seat": color } as CSSProperties}
    >
      <span className="relative z-[1] block" data-spot={seat}>
        {shown ? (
          <span className="absolute left-1/2 z-[2] flex -translate-x-1/2" style={{ top: -shownW * 1.4 - 2 }}>
            {shown.map((c, i) => (
              <motion.span key={c} style={{ marginLeft: i ? shownStep - shownW : 0 }} initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} transition={{ duration: 0.3 * PACE, delay: i * 0.08 * PACE }}>
                <PlayingCard card={c} width={shownW} best={rung.includes(c)} />
              </motion.span>
            ))}
          </span>
        ) : (
          <Backs key={`backs${s.hand}`} count={held} folded={folded || (s.turn === -1 && !show.busy)} color={color} width={tight ? 15 : 18} flying={show.dealtCards !== Infinity} />
        )}
        <span className={cn("block rounded-full transition-[box-shadow,opacity,filter] duration-300", up && "poker-up", (folded || out) && "opacity-55 grayscale")}>
          <PlayerAvatar player={player} glow={player.glow} size={avatar} />
        </span>
        {/* Outside the dimmed part: someone who's folded can still be right here. */}
        <span className="absolute -right-0.5 -top-0.5 z-[3] [--dot-ring:var(--background)]">
          <OnlineDot online={online} />
        </span>
        {s.button === seat && <Dealer key={`dealer${s.hand}`} className="-left-[5px] -top-0.5" />}
        <Label text={label} hot={allIn} />
        {show.bets[seat] > 0 && (
          <Bet
            amount={show.bets[seat]}
            color={color}
            sweeping={show.sweeping}
            order={seat}
            tight={tight}
            label={`${player.name} has ${chips(show.bets[seat])} in`}
            className={cn("absolute left-1/2 z-[4] -translate-x-1/2 -translate-y-1/2", tight ? "top-[-22px]" : "top-[-28px]")}
          />
        )}
        {won && won.net > 0 && <Float net={won.net} color={color} hand={s.hand} high={!!shown} />}
      </span>
      <div className="poker-tile -mt-[calc(var(--av)/2)] flex w-full flex-col items-center rounded-md bg-card px-0.5 pb-1.5" style={{ "--av": `${avatar}px`, paddingTop: avatar / 2 + 8 } as CSSProperties}>
        <NameLine player={player} name={player.name} />
        <span className="font-display text-footnote leading-tight">
          <Roll value={show.stacks[seat]} />
        </span>
      </div>
    </div>
  );
}

// Where a seat stands in the hand, and the word on its label: Out, All in, Fold, or its last move this street.
export function statusOf(show: Show, seat: number) {
  const s = show.state;
  const dealt = s.dealt[seat];
  const out = isOut(s, seat);
  const folded = dealt && show.folded[seat];
  const allIn = dealt && !folded && !out && show.stacks[seat] === 0 && show.dealtCards === Infinity;
  const latest = s.turn >= 0 && !show.busy ? s.log.filter((e) => e.seat === seat && e.street === s.street && e.kind !== "blind").at(-1) : undefined;
  const label = out ? "Out" : allIn ? "All in" : folded ? "Fold" : latest ? actionLabel(latest) : null;
  return { dealt, out, folded, allIn, label };
}

// The cards an opponent holds, fanned behind their avatar, going back to the deck if they fold.
function Backs({ count, folded, color, width, flying }: { count: number; folded: boolean; color: string; width: number; flying: boolean }) {
  const hole = useRef<(HTMLSpanElement | null)[]>([]);
  const gone = useRef(folded);
  const still = useReducedMotion();
  // Folded before these ever came on screen: there's nothing to send back.
  const never = useRef(folded).current;
  useEffect(() => {
    if (!folded || gone.current) return;
    gone.current = true;
    hole.current.forEach((el, k) => {
      if (!el) return;
      if (still) return void (el.style.opacity = "0");
      const to = toward(el, "[data-deck]");
      if (!to) return;
      // It stays where it lands, invisible, until the hand's over: going back to its place for even a frame shows as a blip.
      animate(el, { x: to.x, y: to.y, rotate: k % 2 ? 150 : -150, scale: DECK_W / width, opacity: [1, 1, 0] }, { duration: 0.42 * PACE, delay: k * 0.045 * PACE, ease: [0.45, 0, 0.3, 1], opacity: { times: [0, 0.85, 1], duration: 0.42 * PACE, delay: k * 0.045 * PACE } });
    });
  }, [folded, still, width]);
  if (never) return null;
  const spread = count > 2 ? 30 : 28;
  return (
    <span aria-hidden="true" className="absolute left-1/2 top-[-7px] -z-10 size-0">
      {Array.from({ length: count }, (_, k) => {
        const angle = count > 1 ? -spread / 2 + (spread * k) / (count - 1) : 0;
        return (
          <span key={k} ref={(el) => void (hole.current[k] = el)} className="absolute block" style={{ left: -width / 2, top: -width * 0.75 }}>
            <Flying width={width} fly={flying}>
              <PlayingCard width={width} seat={color} style={{ transform: `rotate(${angle}deg) translateX(${angle / 5}px)`, transformOrigin: "50% 120%" }} />
            </Flying>
          </span>
        );
      })}
    </span>
  );
}

// Chips in front of someone this street. The outer span is what flies to the pile: it holds where it lands
// and goes when the amounts are cleared, so nothing comes back for a frame.
export function Bet({ amount, color, sweeping, order, tight, className, label }: { amount: number; color: string; sweeping: boolean; order: number; tight?: boolean; className?: string; label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
  useEffect(() => {
    if (!sweeping || still || !ref.current) return;
    const to = toward(ref.current, "[data-pile]");
    if (!to) return;
    const go = animate(ref.current, { x: to.x, y: to.y, scale: 0.7, opacity: [1, 1, 0] }, { duration: 0.34 * PACE, delay: order * 0.03 * PACE, ease: FLIGHT, opacity: { times: [0, 0.85, 1], duration: 0.34 * PACE, delay: order * 0.03 * PACE } });
    return () => go.stop();
  }, [sweeping, still, order]);
  return (
    <span ref={ref} data-bet className={cn("block", className)} role="img" aria-label={label}>
      <motion.span
        key={amount}
        className={cn("poker-plate flex items-center gap-[3px] whitespace-nowrap rounded-full py-px pl-px font-display", tight ? "pr-1 text-caption" : "pr-[7px] text-footnote")}
        initial={{ opacity: 0.1, scale: 0.6, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.28 * PACE, ease: SPRING }}
      >
        <PokerChip width={tight ? 14 : 18} seat={color} />
        {chips(amount)}
      </motion.span>
    </span>
  );
}

function Label({ text, hot }: { text: string | null; hot: boolean }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 4, scale: 0.7, x: "-50%" }}
          animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
          exit={{ opacity: 0, x: "-50%" }}
          transition={{ duration: 0.22 * PACE, ease: SPRING }}
          className={cn("absolute -bottom-1.5 left-1/2 z-[2] whitespace-nowrap rounded-full px-1.5 text-caption font-bold leading-[15px]", hot ? "bg-[var(--tile-hit)] text-[var(--tile-hit-ink)]" : "bg-foreground text-background")}
        >
          {text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

// What a seat just won, floating up off it.
export function Float({ net, color, hand, high }: { net: number; color: string; hand: number; high?: boolean }) {
  return (
    <motion.span
      key={`won${hand}`}
      initial={{ opacity: 0, y: 0, scale: 0.8, x: "-50%" }}
      animate={{ opacity: [0, 1, 1], y: high ? -72 : -30, scale: 1, x: "-50%" }}
      transition={{ duration: 0.48 * PACE, ease: "easeOut" }}
      className="pointer-events-none absolute left-1/2 top-0 z-10 whitespace-nowrap rounded-full bg-card px-2 font-display text-heading shadow-md"
      style={{ color }}
    >
      +{chips(net)}
    </motion.span>
  );
}

// The dealer button. It's a physical chip 17px across with its D printed on, so its letter is 10px, under the
// smallest text size, like the letters on a card.
export function Dealer({ className }: { className?: string }) {
  return (
    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.25 * PACE, ease: SPRING }} className={cn("poker-dealer absolute z-[2] grid size-[17px] place-items-center rounded-full font-display text-[10px]", className)} role="img" aria-label="Dealer">
      D
    </motion.span>
  );
}

export function NameLine({ player, name }: { player: Player; name: string }) {
  return (
    <span className="flex max-w-full items-center justify-center gap-0.5 text-caption font-semibold">
      <span className="min-w-0 truncate">{name}</span>
      {player.badge && <span className="shrink-0">{player.badge}</span>}
    </span>
  );
}

// Winnings on their way from the pile to a seat.
export function PayChip({ seat, i, color }: { seat: number; i: number; color: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (still) return void (el.style.opacity = "0");
    const table = el.closest("[data-table]")?.getBoundingClientRect();
    const box = (q: string) => el.closest("[data-table]")?.querySelector(q)?.getBoundingClientRect();
    const from = box("[data-pile]");
    const to = box(`[data-spot="${seat}"]`);
    if (!table || !from || !to) return;
    const start = { x: from.left - table.left + from.width / 2 - 9, y: from.top - table.top + from.height / 2 - 9 };
    const end = { x: to.left - table.left + to.width / 2 - 9, y: to.top - table.top + to.height / 2 - 9 };
    const delay = i * 0.045 * PACE;
    animate(el, { x: [start.x, end.x], y: [start.y, end.y], scale: [1, 0.8], opacity: [1, 1, 0] }, { duration: 0.48 * PACE, delay, ease: FLIGHT, opacity: { times: [0, 0.8, 1], duration: 0.48 * PACE, delay } });
  }, [seat, i, still]);
  return (
    <span ref={ref} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-30 block opacity-0">
      <PokerChip width={18} seat={color} />
    </span>
  );
}
