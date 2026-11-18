import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { CaretRightIcon, CastleTurretIcon, PathIcon, ScrollIcon, StackIcon, SwordIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { RESOURCE_NAMES } from "../../../convex/hexhaven/board";
import {
  actor,
  banditHexes,
  handSize,
  publicPoints,
  roadSpots,
  townSpots,
  villageSpots,
  waitingOn,
  type Ev,
  type Held,
  type HexState,
} from "../../../convex/hexhaven/engine";
import { say } from "../../../convex/hexhaven/text";
import { GameFrame } from "@/components/game/GameFrame";
import { usePhoneLandscape } from "@/components/game/landscape";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";
import { sfx } from "@/sound";
import { Board, type Pick } from "./Board";
import { CardsSheet } from "./CardsSheet";
import { Dock, type Building } from "./Dock";
import { PALETTE } from "./palette";
import { ResIcon } from "./parts";
import { TradeSheet } from "./TradeSheet";

const GAIN_SHOWN_MS = 1600;
const NO_GAIN = [0, 0, 0, 0, 0];

function pickFor(s: HexState, seat: number, building: Building | null): Pick | null {
  if (seat < 0 || actor(s) !== seat) return null;
  const ph = s.phase;
  if (ph.k === "setup")
    return ph.at < 0 ? { kind: "village", spots: villageSpots(s, seat, true) } : { kind: "road", spots: roadSpots(s, seat, ph.at) };
  if (ph.k === "bandit") return { kind: "hex", spots: banditHexes(s, seat) };
  if (ph.k === "roads") return { kind: "road", spots: roadSpots(s, seat) };
  if (ph.k === "main" && building === "road") return { kind: "road", spots: roadSpots(s, seat) };
  if (ph.k === "main" && building === "village") return { kind: "village", spots: villageSpots(s, seat) };
  if (ph.k === "main" && building === "town") return { kind: "town", spots: townSpots(s, seat) };
  return null;
}

function useLive(state: HexState, mySeat: number) {
  const seen = useRef(state.seq);
  const hand = mySeat >= 0 ? state.players[mySeat].res : NO_GAIN;
  const prevHand = useRef(hand);
  const [gained, setGained] = useState(NO_GAIN);
  useEffect(() => {
    const fresh = state.log.filter((e) => e.n >= seen.current);
    seen.current = state.seq;
    const others = fresh.filter((e) => !("seat" in e) || e.seat !== mySeat);
    if (others.some((e) => e.t === "roll")) sfx("shuffle", { live: true });
    if (others.some((e) => e.t === "build")) sfx("place", { live: true });
    if (fresh.some((e) => e.t === "steal" && e.from === mySeat)) sfx("invalid", { live: true });
    if (fresh.some((e) => e.t === "offer" && e.offer.from !== mySeat && (e.offer.to === mySeat || e.offer.to < 0)))
      sfx("knock", { live: true });
    if (fresh.some((e) => e.t === "turn" && e.seat === mySeat)) sfx("turn", { live: true });
  }, [state.seq, state.log, mySeat]);
  useEffect(() => {
    const diff = hand.map((n, r) => n - prevHand.current[r]);
    prevHand.current = hand;
    if (!diff.some((d) => d)) return;
    if (diff.some((d) => d > 0)) sfx("chips", { live: true });
    setGained(diff);
    const t = setTimeout(() => setGained(NO_GAIN), GAIN_SHOWN_MS);
    return () => clearTimeout(t);
  }, [hand]);
  return gained;
}

export default function HexhavenGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const state = match.state as HexState;
  const mySeat = match.players.findIndex((p) => p.userId === meId);
  const playing = mySeat >= 0;
  const landscape = usePhoneLandscape();
  const held = useQuery(api.hexhaven.cards, playing ? { id: match._id } : "skip") ?? [];
  const [building, setBuilding] = useState<Building | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [sheet, setSheet] = useState<"trade" | "cards" | "log" | null>(null);
  const [player, setPlayer] = useState<number | null>(null);
  const [tradeWith, setTradeWith] = useState<number | undefined>(undefined);
  const gained = useLive(state, mySeat);
  const active = match.status === "active";
  const pick = active ? pickFor(state, mySeat, building) : null;
  const pickKey = pick ? `${state.phase.k}:${pick.kind}` : "";
  const [chosenFor, setChosenFor] = useState(pickKey);
  if (chosenFor !== pickKey) {
    setChosenFor(pickKey);
    setChosen(null);
  }
  const live = chosen !== null && pick?.spots.includes(chosen) ? chosen : null;
  const colors = match.players.map((p) => seatColor(p));

  const wasOver = useRef(match.status === "finished");
  useEffect(() => {
    if (match.status !== "finished" || wasOver.current) return;
    wasOver.current = true;
    if (mySeat >= 0) sfx(match.result?.winners.includes(match.players[mySeat].userId) ? "win" : "lose");
  }, [match.status, match.result, match.players, mySeat]);

  const top = <TopLine state={state} onLog={() => setSheet("log")} />;
  const players = <Players match={match} state={state} mySeat={mySeat} onPlayer={setPlayer} />;
  return (
    <GameFrame
      tight
      aside={
        landscape ? (
          <div className="flex flex-col gap-1">
            {top}
            {players}
          </div>
        ) : undefined
      }
      dock={
        <Dock
          match={match}
          meId={meId}
          state={state}
          mySeat={mySeat}
          held={held}
          gained={gained}
          pick={pick}
          chosen={live}
          building={building}
          setBuilding={setBuilding}
          onDone={() => setChosen(null)}
          onTrade={() => {
            setTradeWith(undefined);
            setSheet("trade");
          }}
          onCards={() => setSheet("cards")}
        />
      }
    >
      {!landscape && top}
      {!landscape && players}
      <div className="relative phone-landscape:square-fit" data-seq={state.seq}>
        <Board state={state} colors={colors} pick={pick} chosen={live} onChoose={setChosen} ghostColor={colors[mySeat]} />
      </div>
      {playing && (
        <>
          <TradeSheet
            open={sheet === "trade"}
            onClose={() => setSheet(null)}
            match={match}
            state={state}
            seat={mySeat}
            partner={tradeWith}
          />
          <CardsSheet open={sheet === "cards"} onClose={() => setSheet(null)} match={match} state={state} seat={mySeat} held={held} />
        </>
      )}
      <LogSheet open={sheet === "log"} onClose={() => setSheet(null)} match={match} state={state} mySeat={mySeat} />
      <PlayerSheet
        seat={player}
        onClose={() => setPlayer(null)}
        match={match}
        state={state}
        mySeat={mySeat}
        held={held}
        onTrade={() => {
          setTradeWith(player ?? undefined);
          setPlayer(null);
          setSheet("trade");
        }}
      />
    </GameFrame>
  );
}

function Die({ n }: { n: number }) {
  const dots: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [
      [0, 0],
      [2, 2],
    ],
    3: [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    4: [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ],
    5: [
      [0, 0],
      [2, 0],
      [1, 1],
      [0, 2],
      [2, 2],
    ],
    6: [
      [0, 0],
      [2, 0],
      [0, 1],
      [2, 1],
      [0, 2],
      [2, 2],
    ],
  };
  return (
    <svg viewBox="0 0 30 30" width={28} height={28} aria-hidden="true">
      <rect x="1" y="1" width="28" height="28" rx="6" fill={PALETTE.dieFace} />
      {dots[n]?.map(([x, y], i) => (
        <circle key={i} cx={7 + x * 8} cy={7 + y * 8} r="2.6" fill={PALETTE.dieInk} />
      ))}
    </svg>
  );
}

function TopLine({ state, onLog }: { state: HexState; onLog: () => void }) {
  const lastRoll = [...state.log].reverse().find((e) => e.t === "roll");
  return (
    <div className="flex h-11 items-center justify-between gap-2 px-1">
      <p className="flex items-center gap-2 text-footnote text-muted-foreground tabular-nums">
        <span className="font-semibold text-foreground">{state.phase.k === "setup" ? "Settling" : `Turn ${state.turn}`}</span>
        <span>First to {state.rules.points}</span>
      </p>
      <div className="flex items-center gap-1">
        <AnimatePresence mode="popLayout" initial={false}>
          {state.dice && (
            <motion.span
              key={lastRoll?.n ?? "dice"}
              className="flex items-center gap-1"
              aria-label={`Rolled ${state.dice[0] + state.dice[1]}`}
              data-roll={state.dice[0] + state.dice[1]}
              initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", bounce: 0.35, duration: 0.5 }}
            >
              <Die n={state.dice[0]} />
              <Die n={state.dice[1]} />
            </motion.span>
          )}
        </AnimatePresence>
        <Button variant="ghost" size="sm" className="-mr-2 gap-1 text-muted-foreground" onClick={onLog}>
          Log <CaretRightIcon weight="bold" />
        </Button>
      </div>
    </div>
  );
}

function Players({
  match,
  state,
  mySeat,
  onPlayer,
}: {
  match: MatchView;
  state: HexState;
  mySeat: number;
  onPlayer: (seat: number) => void;
}) {
  const waiting = new Set(waitingOn(state));
  return (
    <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 phone-landscape:flex-wrap" aria-label="Players">
      {state.players.map((p, seat) => {
        const pl = match.players[seat];
        const pts = p.points ?? publicPoints(state, seat);
        return (
          <Button
            key={seat}
            variant="bare"
            size="chip"
            data-seat={seat}
            data-points={pts}
            onClick={() => onPlayer(seat)}
            aria-label={`${seat === mySeat ? "You" : pl.name}: ${pts} points, ${handSize(p.res)} cards`}
            className={cn(
              "relative shrink-0 rounded-full py-1 pl-1 pr-3 transition-colors duration-150",
              waiting.has(seat) ? "bg-primary/15" : "bg-muted/60",
              p.out && "opacity-45",
            )}
          >
            <PlayerAvatar player={pl} size={32} seat={seatColor(pl, p.out)} />
            <span className="flex flex-col leading-tight">
              <span className="font-display text-callout tabular-nums">{pts}</span>
              <span className="flex items-center gap-1 text-caption text-muted-foreground tabular-nums">
                <StackIcon size={11} weight="fill" />
                {handSize(p.res)}
                <ScrollIcon size={11} weight="fill" />
                {p.devs}
                {state.longest === seat && <PathIcon size={11} weight="fill" className="text-primary" />}
                {state.army === seat && <SwordIcon size={11} weight="fill" className="text-primary" />}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function LogSheet({
  open,
  onClose,
  match,
  state,
  mySeat,
}: {
  open: boolean;
  onClose: () => void;
  match: MatchView;
  state: HexState;
  mySeat: number;
}) {
  const name = (seat: number) => (seat === mySeat ? "you" : (match.players[seat]?.name ?? "someone"));
  const lines = [...state.log]
    .reverse()
    .map((e: Ev) => ({ n: e.n, text: say(e, name) }))
    .filter((l): l is { n: number; text: string } => !!l.text);
  return (
    <Sheet open={open} onClose={onClose} title="What happened" closable>
      <ol className="flex flex-col gap-1.5 text-callout" aria-label="What happened">
        {lines.map((l) => (
          <li key={l.n} className="rounded-md bg-muted/50 px-3 py-2">
            {l.text}
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

function PlayerSheet({
  seat,
  onClose,
  match,
  state,
  mySeat,
  held,
  onTrade,
}: {
  seat: number | null;
  onClose: () => void;
  match: MatchView;
  state: HexState;
  mySeat: number;
  held: Held[];
  onTrade: () => void;
}) {
  const p = seat === null ? null : state.players[seat];
  const pl = seat === null ? null : match.players[seat];
  const canTrade =
    seat !== null &&
    seat !== mySeat &&
    mySeat >= 0 &&
    !state.players[seat].out &&
    match.status === "active" &&
    state.phase.k === "main" &&
    (state.current === mySeat || state.current === seat);
  const mine = seat === mySeat;
  const secret = mine ? held.filter((h) => h.c === "point").length : 0;
  return (
    <Sheet open={seat !== null} onClose={onClose} title={pl ? (mine ? "You" : pl.name) : ""} closable>
      {p && pl && seat !== null && (
        <>
          <div className="flex items-center gap-3">
            <PlayerAvatar player={pl} size={56} seat={seatColor(pl, p.out)} />
            <div>
              <div className="font-display text-title tabular-nums">{p.points ?? publicPoints(state, seat)} points</div>
              <div className="text-footnote text-muted-foreground">
                {secret > 0 && `+${secret} hidden · `}
                {p.knights} knights · road of {state.lengths[seat] ?? 0}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1.5" aria-label="Their cards" role="list">
            {p.res.map((n, r) => (
              <div
                key={r}
                role="listitem"
                aria-label={`${n} ${RESOURCE_NAMES[r].toLowerCase()}`}
                className="flex h-12 items-center justify-center gap-1.5 rounded-md bg-muted/60"
              >
                <ResIcon r={r} size={24} />
                <span className="font-display text-body tabular-nums">{n}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-callout">
            <span className="flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1.5">
              <ScrollIcon weight="fill" /> {p.devs} cards held
            </span>
            {state.longest === seat && (
              <span className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5">
                <PathIcon weight="fill" /> Longest road
              </span>
            )}
            {state.army === seat && (
              <span className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5">
                <SwordIcon weight="fill" /> Largest Army
              </span>
            )}
            <span className="flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1.5">
              <CastleTurretIcon weight="fill" /> {state.spots.filter((x) => x?.seat === seat && x.town).length} cities
            </span>
          </div>
          {canTrade && (
            <Button size="xl" variant="secondary" className="w-full" onClick={onTrade}>
              Trade with {pl.name}
            </Button>
          )}
        </>
      )}
    </Sheet>
  );
}
