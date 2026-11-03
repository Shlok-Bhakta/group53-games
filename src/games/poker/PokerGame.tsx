import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowFatUpIcon, CaretRightIcon, CoinsIcon, HandPalmIcon, HandTapIcon, MinusIcon, PlusIcon, XIcon, type Icon } from "@phosphor-icons/react";
import { Slider } from "radix-ui";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { settingsOf } from "../../../convex/modes";
import { isOut, potOf, raiseBounds, streetOf, toCall, type HandResult, type PokerState } from "../../../convex/poker/engine";
import { resultText } from "../../../convex/poker/text";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ResignButton, Result } from "@/components/match";
import { sfx } from "@/sound";
import { cn } from "@/lib/utils";
import { PlayingCard } from "@/components/ui/playing-card";
import { useShow } from "./show";
import { Table } from "./Table";

type Move = { kind: "fold" | "check" | "call" | "raise" | "draw"; to?: number; discard?: number[] };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const chips = (n: number) => n.toLocaleString("en-US");
// The pot as everyone thinks of it: what's in the middle plus what's in front of everyone.
const totalPot = (s: PokerState) => potOf(s) + sum(s.bets);
// A game that's only just started gets its first deal played. Opened any later, it's already on the table.
const FRESH_MS = 4000;

// A poker game: the table and its players as one block in the middle, my cards under it, and the actions
// docked at the bottom where thumbs are. All of it draws the show (see show.ts), not the latest state, so
// what's on screen plays out in order.
export function PokerGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const real = match.state as PokerState;
  const mySeat = match.players.findIndex((p) => p.userId === meId);
  const playing = mySeat >= 0;
  const active = match.status === "active";
  const nameOf = (seat: number) => (match.players[seat].userId === meId ? "You" : match.players[seat].name);
  const show = useShow(real, { mySeat, nameOf, fresh: active && real.hand === 1 && real.log.length <= 2 && Date.now() - (match.startedAt ?? 0) < FRESH_MS });
  const state = show.state;
  const myTurn = active && playing && !show.busy && show.turn === mySeat;
  const hand = useQuery(api.poker.cards, playing ? { id: match._id } : "skip");
  // The cards of the hand on screen, which can be a hand behind the server while the last one plays out.
  const held = useRef<Record<number, string[]>>({});
  if (hand) held.current[hand.hand] = hand.cards;
  const myCards = held.current[state.hand] ?? null;
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
  };

  // The result sound waits for the last hand to finish playing, like the result itself.
  const over = match.status === "finished" && !show.busy && !show.behind;
  const wasOver = useRef(match.status === "finished");
  useEffect(() => {
    if (!over || wasOver.current) return;
    wasOver.current = true;
    if (mySeat >= 0) sfx(match.result?.winners.includes(match.players[mySeat].userId) ? "win" : "lose");
  }, [over, match.result, match.players, mySeat]);

  const dock = over ? (
    <Result match={match} meId={meId} />
  ) : show.busy || match.status === "finished" ? (
    <div className="h-[60px]" />
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
        <Table match={match} show={show} over={over} mySeat={mySeat} cards={myCards} picking={myTurn && draw} swap={swap} onPick={toggleSwap} />
      </div>
      <div className="pt-1.5">{dock}</div>
    </>
  );
}

function DockNote({ children }: { children: ReactNode }) {
  return <p className="flex h-[60px] items-center justify-center text-center text-callout text-muted-foreground">{children}</p>;
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
      <AsyncButton className={bar} icon={owe === 0 ? <HandTapIcon weight="fill" /> : <CoinsIcon weight="fill" />} onClick={() => move(owe > 0 ? { kind: "call" } : { kind: "check" })}>
        {owe === 0 ? "Check" : `${owe >= stack ? "All in" : "Call"} ${chips(Math.min(owe, stack))}`}
      </AsyncButton>
      {bounds && (
        <>
          <Button variant="secondary" className={cn(bar, "bg-card")} onClick={() => setRaising(true)}>
            <ArrowFatUpIcon weight="bold" />
            {state.current === 0 ? "Bet" : "Raise"}
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
    // Pot limit can stop short of everything I have.
    { label: bounds.max >= state.bets[seat] + state.stacks[seat] ? "All in" : "Max", value: bounds.max },
  ];
  // Two sizes can come to the same amount; one lights up.
  const lit = [...sizes].reverse().find((x) => x.value === to);
  const step = state.bb;
  // The slider moves in big blinds, except at its ends.
  const snap = (v: number) => (v >= bounds.max ? bounds.max : v <= bounds.min ? bounds.min : clamp(Math.round(v / step) * step));
  const allIn = to >= state.bets[seat] + state.stacks[seat];
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <SheetHeader title={bet ? "Bet" : "Raise to"} />
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
              <Button key={s.label} variant={lit === s ? "default" : "secondary"} className="h-11 px-1" onClick={() => setTo(s.value)}>
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
    { kind: "checkfold" as const, amount: 0, label: "Check/Fold", Icon: HandPalmIcon as Icon },
    owe === 0
      ? { kind: "check" as const, amount: 0, label: "Check", Icon: HandTapIcon as Icon }
      : { kind: "call" as const, amount: owe, label: owe >= state.stacks[seat] ? "Call all in" : `Call ${chips(owe)}`, Icon: CoinsIcon as Icon },
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
            icon={<o.Icon weight={on ? "fill" : "bold"} />}
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
        <SheetHeader title={`Hand ${result.hand}`} />
        <div className="flex flex-col gap-4 px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <p className="text-center text-callout text-muted-foreground">{resultText(result, (s) => match.players[s].name)}</p>
          {result.board.length > 0 && (
            <div role="group" className="poker-felt flex justify-center gap-1.5 rounded-lg py-3" aria-label="Board">
              {result.board.map((c) => (
                <PlayingCard key={c} card={c} width={40} />
              ))}
            </div>
          )}
          <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card">
            {rows.map((r) => (
              <li key={r.seat} className="flex min-h-16 items-center gap-3 px-3 py-2">
                <PlayerAvatar name={r.p.name} image={r.p.image} frame={r.p.frame} frameColor={r.p.frameColor} glow={r.p.glow} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.p.name}</p>
                  {r.name && <p className="text-footnote leading-tight text-muted-foreground">{r.name}</p>}
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


// A sheet's title with a close button: these sheets sit over the dock, so closing one shouldn't depend on
// knowing to swipe it down.
function SheetHeader({ title }: { title: string }) {
  return (
    <DrawerHeader className="relative">
      <DrawerTitle>{title}</DrawerTitle>
      <DrawerClose asChild>
        <Button variant="ghost" size="icon" aria-label="Close" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
          <XIcon weight="bold" />
        </Button>
      </DrawerClose>
    </DrawerHeader>
  );
}
