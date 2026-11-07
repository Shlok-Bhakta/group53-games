import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { bestHand, madeCards } from "../../../convex/poker/cards";
import { VARIANTS, isOut, streetOf } from "../../../convex/poker/engine";
import { actionLabel } from "../../../convex/poker/text";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayingCard, PokerChip } from "@/components/ui/playing-card";
import { OnlineDot, ThinkingDots, useHere } from "@/presence";
import { SEAT_COLORS } from "@/games/seats";
import { cn } from "@/lib/utils";
import { PACE, cardsHeld, type Show, type Spell } from "./show";

type Player = MatchView["players"][number];

const chips = (n: number) => n.toLocaleString("en-US");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const colorOf = (p: Player) => SEAT_COLORS[p.color ?? "red"];
const SPRING = [0.34, 1.45, 0.64, 1] as const;
const FLIGHT = [0.2, 0.85, 0.25, 1] as const;
const DECK_W = 28;

// How far something has to travel to reach the deck, the pile or a seat, from where it sits on the table.
function toward(el: HTMLElement, selector: string) {
  const there = el.closest("[data-table]")?.querySelector(selector)?.getBoundingClientRect();
  const here = el.getBoundingClientRect();
  if (!there) return null;
  return { x: there.left + there.width / 2 - (here.left + here.width / 2), y: there.top + there.height / 2 - (here.top + here.height / 2) };
}

// A card dealt to where it belongs. It's the real card from the first frame, in its final place, and flies
// there from the deck, so there's nothing to swap at the end of the flight. The rotation of a fan belongs to
// whatever's inside.
function Flying({ width, fly, spin = -14, className, children }: { width: number; fly: boolean; spin?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
  useLayoutEffect(() => {
    if (!fly || still || !ref.current) return;
    const from = toward(ref.current, "[data-deck]");
    if (!from) return;
    const flight = animate(ref.current, { x: [from.x, 0], y: [from.y, 0], scale: [DECK_W / width, 1], rotate: [spin, 0] }, { duration: 0.34 * PACE, ease: FLIGHT });
    return () => flight.cancel();
    // Only ever on arriving.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span ref={ref} className={cn("block", className)}>
      {children}
    </span>
  );
}

// Everything on the table. Mine comes last: my tile, then my cards, big.
export function Table({
  match,
  show,
  over,
  mySeat,
  cards,
  picking,
  swap,
  onPick,
}: {
  match: MatchView;
  show: Show;
  over: boolean;
  mySeat: number;
  cards: string[] | null;
  picking: boolean;
  swap: number[];
  onPick: (i: number) => void;
}) {
  const s = show.state;
  const n = match.players.length;
  const me = mySeat >= 0 ? match.players[mySeat] : null;
  // Everyone else along the rail, starting on my left, so the order of play runs left to right.
  const others = Array.from({ length: n }, (_, k) => (Math.max(mySeat, -1) + 1 + k) % n).filter((seat) => seat !== mySeat);
  const crowd = others.length;
  const avatar = crowd >= 6 ? 30 : crowd >= 4 ? 36 : 42;
  const made = cards && mySeat >= 0 && !show.folded[mySeat] && show.faceUp === Infinity ? bestHand(s.variant, cards, show.board) : null;
  // A hand that's over rings the five that won it; until then, what I'm making out of the board.
  const rung: string[] = show.best ?? madeCards(made);

  return (
    <div role="group" aria-label="Poker table" data-table className="relative flex flex-col tabular-nums">
      <div className="poker-felt rounded-lg px-3 pb-[66px] pt-3">
        <div className="relative grid h-11 grid-cols-[1fr_auto_1fr] items-center">
          <span className="truncate pl-1.5 text-footnote font-semibold opacity-80">{show.banner ? "" : streetOf(s).name}</span>
          {show.banner ? (
            <motion.p
              key={show.banner}
              data-pile
              initial={{ opacity: 0, y: 6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", bounce: 0.3, duration: 0.4 * PACE }}
              className="poker-plate w-[230px] rounded-md px-2.5 py-1 text-center text-footnote font-semibold leading-tight"
            >
              {show.banner}
            </motion.p>
          ) : (
            <span className="flex items-center gap-1.5">
              <Pile show={show} match={match} />
              <span className="poker-plate flex h-7 items-center whitespace-nowrap rounded-full px-3 font-display text-callout">
                <Roll value={sum(show.paid)} prefix="Pot " />
              </span>
            </span>
          )}
          <Deck hand={s.hand} shuffling={show.dealtCards === 0} />
        </div>
        <Board show={show} rung={rung} />
        <p aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-[44px] whitespace-nowrap text-center text-caption font-bold tracking-[0.14em] opacity-20">
          FORCE PUSH PAYS 2 TO 1
        </p>
      </div>

      <div className="relative z-[1] -mt-[18px] flex justify-center gap-1 px-1.5">
        {others.map((seat) => (
          <Seat key={seat} player={match.players[seat]} seat={seat} show={show} avatar={avatar} tight={crowd >= 6} room={Math.min(92, 345 / Math.max(1, crowd) - 4)} active={match.status === "active"} rung={rung} />
        ))}
      </div>

      <AnimatePresence>{show.spell && <SpellOut key={show.spell.word} spell={show.spell} />}</AnimatePresence>
      {show.paying?.map(({ seat }) => Array.from({ length: 5 }, (_, i) => <PayChip key={`${s.hand}:${seat}:${i}`} seat={seat} i={i} color={colorOf(match.players[seat])} />))}

      {me ? (
        <>
          <MyTile match={match} player={me} seat={mySeat} show={show} picking={picking} />
          {!over && <MyHand show={show} seat={mySeat} color={colorOf(me)} cards={cards} picking={picking} swap={swap} onPick={onPick} rung={rung} madeName={show.folded[mySeat] || isOut(s, mySeat) ? null : (made?.name ?? null)} />}
        </>
      ) : (
        <div className="mt-2.5 flex h-11 items-center justify-center">
          <TurnStatus match={match} show={show} />
        </div>
      )}
    </div>
  );
}

// A number that counts its way to a new value.
function Roll({ value, prefix = "" }: { value: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const was = useRef(value);
  const still = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || was.current === value) return;
    const write = (v: number) => {
      was.current = v;
      el.textContent = prefix + chips(Math.round(v));
    };
    if (still) return write(value);
    const roll = animate(was.current, value, { duration: 0.42 * PACE, ease: "easeOut", onUpdate: write, onComplete: () => write(value) });
    return () => roll.stop();
  }, [value, prefix, still]);
  return <span ref={ref}>{prefix + chips(Math.round(was.current))}</span>;
}

// The chips gathered so far, a few for each seat that's put something in, in their colors.
function Pile({ show, match }: { show: Show; match: MatchView }) {
  const bb = show.state.bb || 1;
  const pile = show.paid.flatMap((paid, seat) => {
    const gathered = paid - show.bets[seat];
    if (gathered <= 0) return [];
    const count = Math.min(3, 1 + Math.floor(gathered / (bb * 4)));
    return Array.from({ length: count }, (_, k) => ({ key: `${seat}:${k}`, color: colorOf(match.players[seat]) }));
  });
  return (
    <span data-pile className="relative h-6 w-8" aria-hidden="true">
      {pile.slice(0, 9).map((c, i) => (
        <motion.span
          key={`${show.state.hand}:${c.key}`}
          className="absolute"
          style={{ left: 4 + ((i * 11) % 22), top: 7 - (i % 3) * 3 }}
          initial={{ scale: 1.5, opacity: 0.3 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.22 * PACE, ease: SPRING }}
        >
          <PokerChip width={16} seat={c.color} />
        </motion.span>
      ))}
    </span>
  );
}

// A little stack of backs, which gives a shake when it's shuffled, and where every card flies from and to.
function Deck({ hand, shuffling }: { hand: number; shuffling: boolean }) {
  return (
    <motion.span
      key={shuffling ? `shuffle${hand}` : "deck"}
      data-deck
      aria-hidden="true"
      className="relative mr-1.5 h-[39px] w-7 justify-self-end"
      animate={shuffling ? { rotate: [0, -6, 5, 0] } : undefined}
      transition={{ duration: 0.3 * PACE }}
    >
      {[-4, -2, 0].map((x) => (
        <span key={x} className="absolute block" style={{ left: x, top: -x / 2 }}>
          <PlayingCard width={DECK_W} />
        </span>
      ))}
    </motion.span>
  );
}

function Board({ show, rung }: { show: Show; rung: string[] }) {
  const s = show.state;
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(64);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const fit = () => setWidth(Math.min(64, Math.floor((el.clientWidth - 20) / 5)));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [s.variant]);
  // No flights for what's already out when the table first appears.
  const opened = useRef(false);
  useEffect(() => {
    opened.current = true;
  }, []);
  if (s.variant === "draw") return <div className="h-3" />;
  const ending = !!show.best;
  return (
    <div ref={row} role="group" aria-label="Board" className="relative mt-1.5 flex justify-center gap-[5px]">
      {Array.from({ length: 5 }, (_, i) => {
        const card = show.board[i];
        const best = !!card && rung.includes(card);
        return <BoardCard key={card ? `${s.hand}${card}` : `slot${i}`} card={card} width={width} best={best} lift={ending && best} dim={ending && !best} fly={opened.current} />;
      })}
    </div>
  );
}

function BoardCard({ card, width, best, lift, dim, fly }: { card?: string; width: number; best: boolean; lift: boolean; dim: boolean; fly: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
  useLayoutEffect(() => {
    if (!card || !fly || still || !ref.current) return;
    const from = toward(ref.current, "[data-deck]");
    if (!from) return;
    const flight = animate(ref.current, { x: [from.x, 0], y: [from.y, 0], scale: [0.45, 1], rotateY: [90, 0], opacity: [0.6, 1] }, { duration: 0.4 * PACE, ease: FLIGHT, scale: { duration: 0.4 * PACE, ease: SPRING } });
    return () => flight.cancel();
    // Only ever on arriving.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span ref={ref} className="block shrink-0">
      {card ? <PlayingCard card={card} width={width} best={best} className={cn(dim && "opacity-40", lift && "-translate-y-[5px]")} /> : <PlayingCard slot width={width} />}
    </span>
  );
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
function Bet({ amount, color, sweeping, order, tight, className, label }: { amount: number; color: string; sweeping: boolean; order: number; tight?: boolean; className?: string; label: string }) {
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

function statusOf(show: Show, seat: number) {
  const s = show.state;
  const dealt = s.dealt[seat];
  const out = isOut(s, seat);
  const folded = dealt && show.folded[seat];
  const allIn = dealt && !folded && !out && show.stacks[seat] === 0 && show.dealtCards === Infinity;
  const latest = s.turn >= 0 && !show.busy ? s.log.filter((e) => e.seat === seat && e.street === s.street && e.kind !== "blind").at(-1) : undefined;
  const label = out ? "Out" : allIn ? "All in" : folded ? "Fold" : latest ? actionLabel(latest) : null;
  return { dealt, out, folded, allIn, label };
}

function Float({ net, color, hand, high }: { net: number; color: string; hand: number; high?: boolean }) {
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

function Dealer({ className }: { className?: string }) {
  return (
    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.25 * PACE, ease: SPRING }} className={cn("poker-dealer absolute z-[2] grid size-[17px] place-items-center rounded-full font-display text-[10px]", className)} role="img" aria-label="Dealer">
      D
    </motion.span>
  );
}

function NameLine({ player, name }: { player: Player; name: string }) {
  return (
    <span className="flex max-w-full items-center justify-center gap-0.5 text-caption font-semibold">
      <span className="min-w-0 truncate">{name}</span>
      {player.badge && <span className="shrink-0">{player.badge}</span>}
    </span>
  );
}

// Someone along the rail: their avatar sits on the table's edge, with their cards behind it, on a tile with
// their name and chips.
function Seat({ player, seat, show, avatar, tight, room, active, rung }: { player: Player; seat: number; show: Show; avatar: number; tight: boolean; room: number; active: boolean; rung: string[] }) {
  const s = show.state;
  const { online } = useHere(player.userId);
  const { dealt, out, folded, allIn, label } = statusOf(show, seat);
  const color = colorOf(player);
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
          <PlayerAvatar name={player.name} image={player.image} frame={player.frame} frameColor={player.frameColor} glow={player.glow} size={avatar} />
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

// Winnings on their way from the pile to a seat.
function PayChip({ seat, i, color }: { seat: number; i: number; color: string }) {
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

// ALL IN, or the name of a big hand, spelled in tiles over the board.
function SpellOut({ spell }: { spell: Spell }) {
  const words = spell.word.split(" ");
  const size = Math.min(40, Math.floor(330 / Math.max(...words.map((w) => w.length))) - 4);
  let at = 0;
  const lastAt = spell.word.replace(/ /g, "").length - 1;
  return (
    <motion.div role="img" aria-label={spell.word} className="pointer-events-none absolute inset-x-2 top-[64px] z-20 flex flex-wrap justify-center gap-x-2 gap-y-1 font-display" exit={{ opacity: 0 }} transition={{ duration: 0.2 * PACE }}>
      {words.map((word) => (
        <span key={word} className="flex gap-1">
          {[...word].map((ch, k) => {
            const i = at++;
            const hit = spell.tone === "hit" && i === lastAt;
            return (
              <motion.span
                key={k}
                className={cn("grid place-items-center rounded-sm shadow-md", hit ? "bg-[var(--tile-hit)] text-[var(--tile-hit-ink)]" : spell.tone === "green" ? "bg-[var(--tile-green)] text-[var(--tile-ink)]" : "bg-[var(--tile-yellow)] text-[var(--tile-yellow-ink,var(--tile-ink))]")}
                style={{ width: size, height: size, fontSize: size * 0.58, rotate: hit ? -8 : 0 }}
                initial={{ opacity: 0, y: -28, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.38 * PACE, delay: i * 0.055 * PACE, ease: SPRING }}
              >
                {ch}
              </motion.span>
            );
          })}
        </span>
      ))}
    </motion.div>
  );
}

// What's going on, for whoever's looking at my side of the table.
function TurnStatus({ match, show }: { match: MatchView; show: Show }) {
  const up = match.status === "active" && show.turn >= 0 ? match.players[show.turn] : undefined;
  const { here } = useHere(up?.userId ?? ("" as Id<"users">));
  if (!up) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-footnote font-semibold text-muted-foreground" style={{ "--seat": colorOf(up) } as CSSProperties}>
      <span className="size-2 shrink-0 rounded-full bg-[var(--seat)]" />
      <span className="truncate">{here ? `${up.name} is on it` : `Waiting for ${up.name}`}</span>
      {here && <ThinkingDots />}
    </span>
  );
}

// My tile: my avatar, my chips, what I've got in, and whose move it is.
function MyTile({ match, player, seat, show, picking }: { match: MatchView; player: Player; seat: number; show: Show; picking: boolean }) {
  const s = show.state;
  const { online } = useHere(player.userId);
  const { out, folded, allIn, label } = statusOf(show, seat);
  const color = colorOf(player);
  const up = match.status === "active" && show.turn === seat && !show.busy;
  const won = show.paying?.find((p) => p.seat === seat);
  return (
    <div data-seat={player.color} data-up={up} data-out={out || folded} role="group" aria-label={`You, ${chips(show.stacks[seat])} chips${label ? `, ${label}` : ""}`} className="relative mt-2.5" style={{ "--seat": color } as CSSProperties}>
      <div className="poker-tile flex h-14 items-center gap-2.5 rounded-lg bg-card px-2.5">
        <span className="relative shrink-0" data-spot={seat}>
          <span className={cn("block rounded-full transition-[box-shadow,opacity,filter] duration-300", up && "poker-up", (folded || out) && "opacity-55 grayscale")}>
            <PlayerAvatar name={player.name} image={player.image} frame={player.frame} frameColor={player.frameColor} glow={player.glow} size={38} />
          </span>
          <span className="absolute -right-0.5 -top-0.5 z-[3] [--dot-ring:var(--card)]">
            <OnlineDot online={online} />
          </span>
          {s.button === seat && <Dealer key={`dealer${s.hand}`} className="-left-[5px] -top-0.5" />}
          {won && won.net > 0 && <Float net={won.net} color={color} hand={s.hand} />}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <NameLine player={player} name={player.name} />
          <span className="font-display text-callout">
            <Roll value={show.stacks[seat]} />
          </span>
        </span>
        {show.bets[seat] > 0 && <Bet amount={show.bets[seat]} color={color} sweeping={show.sweeping} order={seat} label={`You have ${chips(show.bets[seat])} in`} className="z-10" />}
        <span className="ml-auto flex min-w-0 items-center">
          {up ? (
            <motion.span
              key="turn"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 * PACE, ease: SPRING }}
              className="block whitespace-nowrap rounded-full bg-primary px-3.5 py-[7px] font-display text-callout text-primary-foreground"
            >
              {picking ? "Pick cards to swap" : "Your move"}
            </motion.span>
          ) : out || folded || allIn ? (
            <span className="text-footnote font-semibold text-muted-foreground">{label}</span>
          ) : (
            <TurnStatus match={match} show={show} />
          )}
        </span>
      </div>
    </div>
  );
}

// My cards, big, and what they make. In a draw, tap the ones to swap. A place for each card is held from the
// start, so nothing moves as they land.
function MyHand({ show, seat, color, cards, picking, swap, onPick, rung, madeName }: { show: Show; seat: number; color: string; cards: string[] | null; picking: boolean; swap: number[]; onPick: (i: number) => void; rung: string[]; madeName: string | null }) {
  const s = show.state;
  const count = VARIANTS[s.variant].hole;
  // Bigger on a phone with the height to spare.
  const roomy = window.innerHeight >= 780;
  const width = count <= 2 ? (roomy ? 88 : 66) : count === 4 ? (roomy ? 74 : 62) : roomy ? 66 : 58;
  const tilt = count <= 2 ? 8 : 3;
  const sitting = !s.dealt[seat] || isOut(s, seat);
  const held = cardsHeld(s, seat, show.dealtCards);
  const dim = s.dealt[seat] && show.folded[seat];
  return (
    <div role="group" aria-label="Your cards" className="mt-4 flex flex-col items-center gap-1">
      <div className={cn("flex items-end justify-center transition-opacity duration-300", dim && "opacity-40")} style={{ minHeight: width * 1.4 + 2 }}>
        {!sitting &&
          Array.from({ length: count }, (_, i) => {
            const angle = (i - (count - 1) / 2) * tilt;
            const c = i < show.faceUp ? (cards?.[i] ?? null) : null;
            const lifted = picking && swap.includes(i);
            const style = { rotate: `${angle}deg`, transformOrigin: "50% 100%" };
            if (i >= held) return <span key={`${s.hand}:${i}`} className="-mx-[3px]" style={{ width, height: width * 1.4 }} />;
            const face = (
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={c ?? "back"}
                  className="block"
                  initial={{ rotateY: -90 }}
                  animate={{ rotateY: 0, y: lifted ? -10 : 0 }}
                  exit={{ rotateY: 90, transition: { duration: 0.12 * PACE, ease: "easeIn" } }}
                  transition={{ type: "spring", bounce: 0.2, duration: 0.3 * PACE }}
                >
                  {c ? <PlayingCard card={c} width={width} best={picking ? lifted : rung.includes(c)} /> : <PlayingCard width={width} seat={color} />}
                </motion.span>
              </AnimatePresence>
            );
            return (
              <Flying key={`${s.hand}:${i}`} width={width} fly={show.dealtCards !== Infinity} className="-mx-[3px]">
                <span className="block" style={style}>
                  {picking && c ? (
                    <button type="button" className="block touch-manipulation rounded-sm active:scale-[0.97]" aria-pressed={lifted} aria-label={`Swap card ${i + 1}`} onClick={() => onPick(i)}>
                      {face}
                    </button>
                  ) : (
                    face
                  )}
                </span>
              </Flying>
            );
          })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={madeName ?? "none"} className="h-[22px] text-callout font-semibold text-muted-foreground" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 * PACE }}>
          {madeName ?? ""}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
