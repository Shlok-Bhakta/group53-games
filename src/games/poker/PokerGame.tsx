import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { CaretRightIcon, CheckIcon, MinusIcon, PlusIcon, SquareIcon, XIcon } from "@phosphor-icons/react";
import { Slider } from "radix-ui";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { settingsOf } from "../../../convex/modes";
import { bestHand } from "../../../convex/poker/cards";
import { VARIANTS, isOut, potOf, raiseBounds, streetOf, toCall, type HandResult, type PokerState } from "../../../convex/poker/engine";
import { actionLabel, resultText } from "../../../convex/poker/text";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ResignButton, Result, ThinkingDots, useHere } from "@/components/match";
import { OnlineDot } from "@/presence";
import { SEAT_COLORS } from "@/games/seats";
import { sfx } from "@/sound";
import { cn } from "@/lib/utils";
import { Chip, PlayingCard } from "./Card";

type Player = MatchView["players"][number];
type Move = { kind: "fold" | "check" | "call" | "raise" | "draw"; to?: number; discard?: number[] };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const chips = (n: number) => n.toLocaleString("en-US");
// The pot as everyone thinks of it: what's in the middle plus what's in front of everyone.
const totalPot = (s: PokerState) => potOf(s) + sum(s.bets);

// A poker game: the table and its players as one block in the middle, my cards under it, and the actions
// docked at the bottom where thumbs are.
export function PokerGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const state = match.state as PokerState;
  const mySeat = match.players.findIndex((p) => p.userId === meId);
  const playing = mySeat >= 0;
  const active = match.status === "active";
  const myTurn = active && playing && state.turn === mySeat;
  const hand = useQuery(api.poker.cards, playing ? { id: match._id } : "skip");
  const myCards = hand && hand.hand === state.hand ? hand.cards : null;
  const draw = streetOf(state).kind === "draw";
  // Cards picked to swap, for the street they were picked on.
  const spot = `${state.hand}:${state.street}`;
  const [picked, setPicked] = useState<{ spot: string; cards: number[] }>({ spot, cards: [] });
  const swap = picked.spot === spot ? picked.cards : [];
  const toggleSwap = (i: number) => {
    sfx("pick");
    setPicked({ spot, cards: swap.includes(i) ? swap.filter((x) => x !== i) : [...swap, i] });
  };

  const send = useMutation(api.poker.move);
  const move = async (m: Move) => {
    await send({ id: match._id, hand: state.hand, street: state.street, ...m });
    sfx(m.kind === "fold" ? "recall" : m.kind === "check" ? "tick" : m.kind === "draw" ? "shuffle" : "place");
  };
  useSounds(match, state, mySeat, myTurn);

  const dock =
    match.status === "finished" ? (
      <Result match={match} meId={meId} />
    ) : !playing ? (
      <DockNote>You're watching.</DockNote>
    ) : isOut(state, mySeat) ? (
      <DockNote>You're out. Stick around to see who wins.</DockNote>
    ) : myTurn && draw ? (
      <AsyncButton className="h-[60px] w-full rounded-lg text-body" onClick={() => move({ kind: "draw", discard: swap })}>
        {swap.length ? `Swap ${swap.length}` : "Keep all five"}
      </AsyncButton>
    ) : myTurn ? (
      <BetDock state={state} seat={mySeat} move={move} />
    ) : (
      <WaitDock match={match} state={state} seat={mySeat} />
    );

  return (
    <>
      <div className="flex flex-1 flex-col justify-center gap-1 py-1">
        <TopLine match={match} state={state} />
        <Table match={match} state={state} mySeat={mySeat} meId={meId} />
        <Status match={match} state={state} meId={meId} />
        {playing && <MyHand state={state} seat={mySeat} cards={myCards} picking={myTurn && draw} swap={swap} onPick={toggleSwap} />}
      </div>
      <div className="pt-3">{dock}</div>
    </>
  );
}

function DockNote({ children }: { children: ReactNode }) {
  return <p className="flex h-[60px] items-center justify-center text-center text-callout text-muted-foreground">{children}</p>;
}

// Sounds for things that happen on other phones: chips going in, cards coming out, a new hand, my turn.
function useSounds(match: MatchView, state: PokerState, mySeat: number, myTurn: boolean) {
  const seen = useRef({ hand: state.hand, log: state.log.length, board: state.board.length, turn: myTurn });
  useEffect(() => {
    const was = seen.current;
    seen.current = { hand: state.hand, log: state.log.length, board: state.board.length, turn: myTurn };
    if (state.hand !== was.hand) {
      sfx(mySeat >= 0 && (state.last?.won[mySeat] ?? 0) > 0 ? "win" : "shuffle");
    } else {
      if (state.board.length > was.board) sfx("land", { count: state.board.length - was.board });
      else if (state.log.length > was.log) {
        const e = state.log.at(-1)!;
        if (e.seat !== mySeat) sfx(e.kind === "fold" ? "recall" : e.kind === "check" ? "tick" : e.kind === "draw" ? "shuffle" : "place");
      }
    }
    if (myTurn && !was.turn) setTimeout(() => sfx("turn"), 350);
  }, [state.hand, state.log, state.board.length, state.last, myTurn, mySeat]);
  const wasActive = useRef(match.status === "active");
  useEffect(() => {
    if (wasActive.current && match.status === "finished" && mySeat >= 0) sfx(match.result?.winners.includes(match.players[mySeat].userId) ? "win" : "lose");
    wasActive.current = match.status === "active";
  }, [match.status, match.result, match.players, mySeat]);
}

// Which hand this is and the blinds, and the last hand's result one tap away.
function TopLine({ match, state }: { match: MatchView; state: PokerState }) {
  const hands = settingsOf(match.mode, match.settings).hands;
  const [open, setOpen] = useState(false);
  const last = state.last;
  return (
    <div className="flex h-11 items-center justify-between gap-2 px-1">
      <p className="flex items-center gap-2 text-footnote text-muted-foreground tabular-nums">
        <span className="font-semibold text-foreground">{hands ? `Hand ${state.hand} of ${hands}` : `Hand ${state.hand}`}</span>
        <span>
          Blinds {chips(state.sb)}/{chips(state.bb)}
        </span>
      </p>
      {last && (
        <>
          <Button variant="ghost" size="sm" className="-mr-2 gap-1 text-muted-foreground" onClick={() => setOpen(true)}>
            Last hand <CaretRightIcon weight="bold" />
          </Button>
          <LastHand match={match} result={last} open={open} onClose={() => setOpen(false)} />
        </>
      )}
    </div>
  );
}

// Where each seat sits round the table, counting clockwise from mine at the bottom, in percent of the table.
function seatSpot(seat: number, base: number, n: number, scale = 1) {
  const angle = ((90 + (((seat - base + n) % n) * 360) / n) * Math.PI) / 180;
  return { x: 50 + 40 * scale * Math.cos(angle), y: 50 + 40.5 * scale * Math.sin(angle) };
}

const FLASH_MS = 3600;

function Table({ match, state, mySeat, meId }: { match: MatchView; state: PokerState; mySeat: number; meId: Id<"users"> | undefined }) {
  const n = match.players.length;
  const base = Math.max(0, mySeat);
  const boardGame = state.variant !== "draw";
  const pot = totalPot(state);
  const over = match.status !== "active";
  // A hand that ends while you watch shows who won it on the table for a moment.
  const [flash, setFlash] = useState<HandResult | null>(null);
  const seenHand = useRef(state.last?.hand ?? 0);
  useEffect(() => {
    const last = state.last;
    if (!last || last.hand === seenHand.current) return;
    seenHand.current = last.hand;
    setFlash(last);
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [state.last]);
  const nameOf = (seat: number) => (match.players[seat].userId === meId ? "You" : match.players[seat].name);

  return (
    <div role="group" className="relative mx-auto aspect-[1/1.04] w-full max-w-[420px]" aria-label="Poker table">
      <div className="felt absolute inset-x-[10%] inset-y-[9%]" style={{ borderRadius: "46% / 34%" }} />
      {/* The middle: the pot, the board, and the street. */}
      <div className="absolute inset-x-[16%] top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 felt-ink">
        <AnimatePresence mode="wait" initial={false}>
          {flash || (over && state.last) ? (
            <motion.p
              key={`flash${(flash ?? state.last)!.hand}`}
              initial={{ opacity: 0, y: 6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", bounce: 0.3, duration: 0.4 }}
              className="max-w-[78%] rounded-md bg-black/35 px-2.5 py-1 text-center text-footnote font-semibold leading-snug"
            >
              {resultText((flash ?? state.last)!, nameOf)}
            </motion.p>
          ) : (
            <motion.p key="pot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-7 items-center gap-1.5 rounded-full bg-black/25 px-3 font-display text-callout tabular-nums">
              Pot {chips(pot)}
            </motion.p>
          )}
        </AnimatePresence>
        {boardGame ? (
          <div role="group" className="flex gap-1" aria-label="Board">
            {Array.from({ length: 5 }, (_, i) => {
              const card = state.board[i];
              return card ? (
                <motion.span key={`${state.hand}${card}`} initial={{ rotateY: 90, opacity: 0, y: -8 }} animate={{ rotateY: 0, opacity: 1, y: 0 }} transition={{ type: "spring", bounce: 0.25, duration: 0.45, delay: Math.max(0, i - 2) * 0.12 }}>
                  <PlayingCard card={card} width={38} />
                </motion.span>
              ) : (
                <PlayingCard key={`slot${i}`} slot width={38} />
              );
            })}
          </div>
        ) : (
          <p className="font-display text-heading">{streetOf(state).name}</p>
        )}
        {boardGame && <p className="h-4 text-caption font-semibold uppercase tracking-wider text-white/60">{state.turn >= 0 ? streetOf(state).name : ""}</p>}
      </div>
      {/* Chips in front of each seat on this street. */}
      {match.players.map((p, seat) => {
        if (!state.bets[seat]) return null;
        const at = seatSpot(seat, base, n, 0.6);
        return (
          <motion.span
            key={`bet${seat}`}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-black/30 py-0.5 pl-0.5 pr-2 font-display text-footnote tabular-nums felt-ink"
            style={{ left: `${at.x}%`, top: `${at.y}%` }}
            data-bet={seat}
          >
            <Chip width={16} seat={SEAT_COLORS[p.color ?? "red"]} />
            {chips(state.bets[seat])}
          </motion.span>
        );
      })}
      {state.button >= 0 && <DealerButton at={seatSpot(state.button, base, n, 0.74)} offset={seatSpot(state.button, base, n, 1)} />}
      {match.players.map((p, seat) => (
        <Seat key={p.userId} player={p} seat={seat} state={state} isMe={p.userId === meId} active={match.status === "active"} at={seatSpot(seat, base, n)} flash={flash} />
      ))}
    </div>
  );
}

// The dealer button sits on the felt by the dealer, a little to their side.
function DealerButton({ at, offset }: { at: { x: number; y: number }; offset: { x: number; y: number } }) {
  // Nudged sideways (perpendicular to the line to the centre) so it doesn't sit under the bet.
  const dx = offset.x - 50;
  const dy = offset.y - 50;
  const len = Math.hypot(dx, dy) || 1;
  const left = at.x + (-dy / len) * 9;
  const top = at.y + (dx / len) * 9;
  return (
    <motion.span
      layout
      transition={{ type: "spring", bounce: 0, duration: 0.5 }}
      className="pdealer absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-display text-caption"
      style={{ left: `${left}%`, top: `${top}%` }}
      aria-label="Dealer"
    >
      D
    </motion.span>
  );
}

function Seat({ player, seat, state, isMe, active, at, flash }: { player: Player; seat: number; state: PokerState; isMe: boolean; active: boolean; at: { x: number; y: number }; flash: HandResult | null }) {
  const { online } = useHere(player.userId);
  const out = isOut(state, seat);
  const dealt = state.dealt[seat];
  const folded = dealt && state.folded[seat];
  const allIn = dealt && !folded && state.stacks[seat] === 0 && !out;
  const toAct = active && state.turn === seat;
  const color = SEAT_COLORS[player.color ?? "red"];
  const latest = state.log.filter((e) => e.seat === seat && e.street === state.street && e.kind !== "blind").at(-1);
  const label = out ? "Out" : allIn ? "All in" : folded ? "Fold" : latest ? actionLabel(latest) : null;
  const shown = flash?.shown[seat];
  const won = flash?.won[seat] ?? 0;
  const holeCount = VARIANTS[state.variant].hole;
  return (
    <div
      data-seat={player.color}
      role="group"
      className="absolute flex w-[78px] -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ left: `${at.x}%`, top: `${at.y}%` }}
      aria-label={`${isMe ? "You" : player.name}, ${chips(state.stacks[seat])} chips${label ? `, ${label}` : ""}`}
    >
      <span className="relative">
        <span
          className={cn("relative flex rounded-full transition-[box-shadow,opacity,filter] duration-300", (folded || out) && "opacity-45 grayscale")}
          style={{ boxShadow: toAct ? `0 0 0 2.5px var(--background), 0 0 0 5px ${color}` : undefined }}
        >
          <PlayerAvatar name={player.name} image={player.image} frame={player.frame} frameColor={player.frameColor} size={40} />
          <span className="absolute -bottom-0.5 -right-0.5 [--dot-ring:var(--background)]">
            <OnlineDot online={online} />
          </span>
        </span>
        {/* Their cards: face down while they're in, face up for a moment at a showdown. */}
        {shown ? (
          <span className="absolute -right-6 -top-1 flex -space-x-3">
            {shown.map((c, i) => (
              <motion.span key={c} initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} transition={{ delay: i * 0.08 }}>
                <PlayingCard card={c} width={24} />
              </motion.span>
            ))}
          </span>
        ) : (
          dealt &&
          !folded &&
          !isMe &&
          active && (
            <span className="absolute -right-4 -top-1 flex -space-x-3.5">
              {Array.from({ length: Math.min(holeCount, 4) }, (_, i) => (
                <PlayingCard key={i} width={18} seat={color} style={{ transform: `rotate(${(i - 1) * 8}deg)` }} />
              ))}
            </span>
          )
        )}
        <AnimatePresence>
          {label && (
            <motion.span
              key={label}
              initial={{ opacity: 0, y: 4, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", bounce: 0.3, duration: 0.3 }}
              className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-foreground px-1.5 py-px text-caption font-bold text-background"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {won > 0 && (
            <motion.span
              key={`won${flash!.hand}`}
              initial={{ opacity: 0, y: 0, scale: 0.8 }}
              animate={{ opacity: 1, y: -30, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", bounce: 0.4, duration: 0.7 }}
              className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 font-display text-heading tabular-nums"
              style={{ color, textShadow: "0 1px 2px rgb(0 0 0 / 0.5)" }}
            >
              +{chips(won)}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="mt-1 flex max-w-full flex-col items-center rounded-sm bg-card px-1.5 py-0.5 leading-tight shadow-sm">
        <span className="max-w-full truncate text-caption font-semibold">{isMe ? "You" : player.name}</span>
        <span className="font-display text-footnote tabular-nums">{chips(state.stacks[seat])}</span>
      </span>
    </div>
  );
}

// The line under the table: whose move it is, live.
function Status({ match, state, meId }: { match: MatchView; state: PokerState; meId: Id<"users"> | undefined }) {
  const up = match.status === "active" && state.turn >= 0 ? match.players[state.turn] : undefined;
  const { here } = useHere(up?.userId ?? ("" as Id<"users">));
  if (!up) return <div className="min-h-11" />;
  const mine = up.userId === meId;
  const draw = streetOf(state).kind === "draw";
  return (
    <p className="flex min-h-11 items-center justify-center gap-2 font-display text-heading">
      <span className="size-2.5 rounded-full" style={{ background: SEAT_COLORS[up.color ?? "red"] }} />
      {mine ? (draw ? "Pick cards to swap" : "Your move") : here ? `${up.name} is on it` : `Waiting for ${up.name}`}
      {!mine && here && <ThinkingDots />}
    </p>
  );
}

// My cards, big, and what they make. In a draw, tap the ones to swap.
function MyHand({ state, seat, cards, picking, swap, onPick }: { state: PokerState; seat: number; cards: string[] | null; picking: boolean; swap: number[]; onPick: (i: number) => void }) {
  const count = VARIANTS[state.variant].hole;
  const width = count <= 2 ? 64 : count === 4 ? 56 : 54;
  const folded = state.dealt[seat] && state.folded[seat];
  const out = isOut(state, seat) || !state.dealt[seat];
  const best = cards && !folded ? bestHand(state.variant, cards, state.board) : null;
  return (
    <div role="group" className="flex h-[140px] flex-col items-center justify-end gap-1.5" aria-label="Your cards">
      {!out && (
        <div className={cn("flex gap-1.5 transition-opacity", folded && "opacity-40")}>
          {(cards ?? Array.from({ length: count }, () => undefined)).map((c, i) => {
            const lifted = swap.includes(i);
            const card = (
              <motion.span key={`${state.hand}:${c ?? i}`} className="block" initial={{ y: 24, opacity: 0 }} animate={{ y: lifted ? -14 : 0, opacity: 1 }} transition={{ type: "spring", bounce: 0.3, duration: 0.4, delay: lifted ? 0 : i * 0.05 }}>
                <PlayingCard card={c} width={width} className={cn(lifted && "ring-3 ring-primary")} />
              </motion.span>
            );
            return picking && c ? (
              <button key={`${state.hand}:${c}`} type="button" className="touch-manipulation rounded-sm active:scale-[0.97]" aria-pressed={lifted} aria-label={`Swap card ${i + 1}`} onClick={() => onPick(i)}>
                {card}
              </button>
            ) : (
              card
            );
          })}
        </div>
      )}
      <p className="h-6 text-callout font-semibold text-muted-foreground">{out ? "" : folded ? "Folded" : (best?.name ?? "")}</p>
    </div>
  );
}

const bar = "h-[60px] flex-col gap-0.5 rounded-lg text-footnote [&_svg:not([class*='size-'])]:size-[22px]";

// My move in a betting round: fold, check or call, and bet or raise.
function BetDock({ state, seat, move }: { state: PokerState; seat: number; move: (m: Move) => Promise<void> }) {
  const owe = toCall(state, seat);
  const stack = state.stacks[seat];
  const bounds = raiseBounds(state, seat);
  const [raising, setRaising] = useState(false);
  const cols = (owe > 0 ? 1 : 0) + 1 + (bounds ? 1 : 0);
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {owe > 0 && (
        <AsyncButton variant="secondary" className={cn(bar, "bg-card")} icon={<XIcon weight="bold" />} onClick={() => move({ kind: "fold" })}>
          Fold
        </AsyncButton>
      )}
      <AsyncButton
        className={cn(bar, "text-callout")}
        aria-label={owe === 0 ? "Check" : `${owe >= stack ? "All in" : "Call"} ${chips(Math.min(owe, stack))}`}
        onClick={() => move(owe > 0 ? { kind: "call" } : { kind: "check" })}
      >
        {owe === 0 ? (
          <span className="font-display text-heading">Check</span>
        ) : (
          <>
            <span>{owe >= stack ? "All in" : "Call"}</span>
            <span className="font-display text-heading tabular-nums">{chips(Math.min(owe, stack))}</span>
          </>
        )}
      </AsyncButton>
      {bounds && (
        <>
          <Button variant="secondary" className={cn(bar, "bg-card text-callout")} onClick={() => setRaising(true)}>
            <span className="font-display text-heading">{state.current === 0 ? "Bet" : "Raise"}</span>
          </Button>
          <RaiseSheet state={state} seat={seat} bounds={bounds} open={raising} onClose={() => setRaising(false)} onRaise={(to) => move({ kind: "raise", to })} />
        </>
      )}
    </div>
  );
}

// How much to bet or raise: a slider, the usual sizes, and fine steps of a big blind.
function RaiseSheet({ state, seat, bounds, open, onClose, onRaise }: { state: PokerState; seat: number; bounds: { min: number; max: number }; open: boolean; onClose: () => void; onRaise: (to: number) => Promise<void> }) {
  const [to, setTo] = useState(bounds.min);
  useEffect(() => {
    if (open) setTo(bounds.min);
  }, [open, bounds.min]);
  const clamp = (v: number) => Math.max(bounds.min, Math.min(bounds.max, Math.round(v)));
  const pot = totalPot(state);
  const owe = toCall(state, seat);
  const bet = state.current === 0;
  const sizes = [
    { label: "Min", value: bounds.min },
    { label: "½ pot", value: clamp(state.current + (pot + owe) / 2) },
    { label: "Pot", value: clamp(state.current + pot + owe) },
    { label: "All in", value: bounds.max },
  ];
  const step = state.bb;
  // The slider moves in big blinds, except at its ends.
  const snap = (v: number) => (v >= bounds.max ? bounds.max : v <= bounds.min ? bounds.min : clamp(Math.round(v / step) * step));
  const allIn = to >= state.bets[seat] + state.stacks[seat];
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{bet ? "Bet" : "Raise to"}</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-4 px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" size="icon-lg" aria-label="Less" disabled={to <= bounds.min} onClick={() => setTo(snap(to - step))}>
              <MinusIcon weight="bold" />
            </Button>
            <span className="font-display text-title-lg tabular-nums" aria-live="polite">
              {chips(to)}
            </span>
            <Button variant="secondary" size="icon-lg" aria-label="More" disabled={to >= bounds.max} onClick={() => setTo(snap(to + step))}>
              <PlusIcon weight="bold" />
            </Button>
          </div>
          <Slider.Root className="relative flex h-11 touch-none select-none items-center" min={bounds.min} max={bounds.max} step={1} value={[to]} onValueChange={([v]) => setTo(snap(v))} aria-label="Amount">
            <Slider.Track className="relative h-2 grow overflow-hidden rounded-full bg-muted">
              <Slider.Range className="absolute h-full bg-primary" />
            </Slider.Track>
            <Slider.Thumb className="block size-7 rounded-full border-2 border-primary bg-background shadow outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
          </Slider.Root>
          <div className="grid grid-cols-4 gap-2">
            {sizes.map((s) => (
              <Button key={s.label} variant={to === s.value ? "default" : "secondary"} className="h-11 px-1" onClick={() => setTo(s.value)}>
                {s.label}
              </Button>
            ))}
          </div>
          <AsyncButton
            size="xl"
            className="h-14 w-full"
            onClick={async () => {
              await onRaise(to);
              onClose();
            }}
          >
            {allIn ? `All in ${chips(to)}` : bet ? `Bet ${chips(to)}` : `Raise to ${chips(to)}`}
          </AsyncButton>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// Not my turn: line up a move for when the action reaches me, so the game doesn't wait on me.
function WaitDock({ match, state, seat }: { match: MatchView; state: PokerState; seat: number }) {
  const plan = useQuery(api.poker.myPlan, { id: match._id });
  const setPlan = useMutation(api.poker.plan).withOptimisticUpdate((store, { id, hand, street, kind, amount }) => {
    store.setQuery(api.poker.myPlan, { id }, kind ? { kind, amount: amount ?? 0, hand, street } : null);
  });
  const resign = (
    <ResignButton
      match={match}
      className={cn(bar, "bg-card")}
      detail={match.players.length > 2 ? "You fold, your chips leave with you, and you place below everyone still playing." : "You fold and your opponent gets the win."}
    />
  );
  const inIt = state.dealt[seat] && !state.folded[seat];
  const canPlan = inIt && state.stacks[seat] > 0 && streetOf(state).kind === "bet" && state.turn >= 0;
  if (!canPlan) {
    const note = !inIt ? "Folded" : state.stacks[seat] === 0 ? "All in" : "Swapping";
    return (
      <div className="grid grid-cols-[2fr_1fr] gap-2.5">
        <p className="flex h-[60px] items-center justify-center rounded-lg text-center text-callout text-muted-foreground">{note}</p>
        {resign}
      </div>
    );
  }
  const owe = toCall(state, seat);
  const options = [
    { kind: "checkfold" as const, amount: 0, label: "Check/Fold" },
    owe === 0 ? { kind: "check" as const, amount: 0, label: "Check" } : { kind: "call" as const, amount: owe, label: owe >= state.stacks[seat] ? "Call all in" : `Call ${chips(owe)}` },
  ];
  const armed = (o: (typeof options)[number]) => !!plan && plan.hand === state.hand && plan.street === state.street && plan.kind === o.kind && (o.kind !== "call" || plan.amount === o.amount);
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {options.map((o) => {
        const on = armed(o);
        return (
          <AsyncButton
            key={o.kind}
            variant={on ? "default" : "secondary"}
            className={cn(bar, !on && "bg-card")}
            aria-pressed={on}
            icon={on ? <CheckIcon weight="bold" /> : <SquareIcon weight="bold" />}
            onClick={() => setPlan({ id: match._id, hand: state.hand, street: state.street, ...(on ? {} : { kind: o.kind, amount: o.amount }) })}
          >
            {o.label}
          </AsyncButton>
        );
      })}
      {resign}
    </div>
  );
}

// The last hand in full: the board, everyone who showed and what they had, and who won what.
function LastHand({ match, result, open, onClose }: { match: MatchView; result: HandResult; open: boolean; onClose: () => void }) {
  const rows = match.players
    .map((p, seat) => ({ p, seat, net: result.net[seat], shown: result.shown[seat], name: result.names[seat] }))
    .filter((r) => r.net !== 0 || r.shown)
    .sort((a, b) => b.net - a.net);
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Hand {result.hand}</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-4 px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <p className="text-center text-callout text-muted-foreground">{resultText(result, (s) => match.players[s].name)}</p>
          {result.board.length > 0 && (
            <div role="group" className="felt flex justify-center gap-1.5 rounded-lg py-3" aria-label="Board">
              {result.board.map((c) => (
                <PlayingCard key={c} card={c} width={40} />
              ))}
            </div>
          )}
          <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card">
            {rows.map((r) => (
              <li key={r.seat} className="flex min-h-16 items-center gap-3 px-3 py-2">
                <PlayerAvatar name={r.p.name} image={r.p.image} frame={r.p.frame} frameColor={r.p.frameColor} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.p.name}</p>
                  {r.name && <p className="truncate text-footnote text-muted-foreground">{r.name}</p>}
                </div>
                {r.shown && (
                  <span className="flex gap-0.5">
                    {r.shown.map((c) => (
                      <PlayingCard key={c} card={c} width={26} />
                    ))}
                  </span>
                )}
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-display text-footnote tabular-nums", r.net > 0 ? "bg-[var(--tile-green)] text-[var(--tile-ink)]" : "text-muted-foreground")}>
                  {r.net > 0 ? "+" : r.net < 0 ? "−" : ""}
                  {chips(Math.abs(r.net))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

