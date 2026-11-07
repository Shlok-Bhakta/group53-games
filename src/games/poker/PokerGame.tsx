import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { settingsOf } from "../../../convex/modes";
import { isOut, streetOf, type PokerState } from "../../../convex/poker/engine";
import { AsyncButton } from "@/components/AsyncButton";
import { DockNote, GameFrame } from "@/components/game/GameFrame";
import { Button } from "@/components/ui/button";
import { Result } from "@/components/match";
import { sfx } from "@/sound";
import { BetDock, type Move } from "./BetDock";
import { chips } from "./format";
import { LastHand } from "./LastHand";
import { useShow } from "./show";
import { Table } from "./Table";
import { WaitDock } from "./WaitDock";

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
    <GameFrame tight dock={dock}>
      <TopLine match={match} state={state} />
      <Table match={match} show={show} over={over} mySeat={mySeat} cards={myCards} picking={myTurn && draw} swap={swap} onPick={toggleSwap} />
    </GameFrame>
  );
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
