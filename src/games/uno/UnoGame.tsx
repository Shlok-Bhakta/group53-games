import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowsClockwiseIcon, CaretRightIcon, CardsIcon, MegaphoneIcon, SirenIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { COLORS, COLOR_NAME, cardName, colorOf, faceOf, isWild, sortHand, type Card, type Color } from "../../../convex/uno/cards";
import { canPass, cantDraw, cantPlay, inHand, isGone, isOutOfHand, next, type UnoState } from "../../../convex/uno/engine";
import { entryText } from "../../../convex/uno/text";
import { usePending } from "@/components/AsyncButton";
import { ActionRail, DockNote, GameFrame } from "@/components/game/GameFrame";
import { TurnText } from "@/components/game/TurnText";
import { ResignButton, Result } from "@/components/match";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";
import { sfx } from "@/sound";
import { UnoCard } from "./Card";

type Move = {
  kind: "play" | "draw" | "pass" | "take" | "challenge" | "roulette" | "catch" | "uno";
  card?: Card;
  color?: Color;
  target?: number;
  uno?: boolean;
  seq?: number;
};
type Ask = { card: Card; need: "color" | "target"; seq: number };

const leftAfter = (cards: Card[], card: Card) =>
  faceOf(card) === "DA" ? cards.filter((c) => isWild(c) || colorOf(c) !== colorOf(card)).length : cards.length - 1;

const HAND_HEIGHT = "h-[144px]";

export default function UnoGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const state = match.state as UnoState;
  const seat = match.players.findIndex((p) => p.userId === meId);
  const mine = useQuery(api.uno.hand, seat >= 0 ? { id: match._id } : "skip");
  const cards = mine && mine.hand === state.hand ? sortHand(mine.cards, state.rules.deck) : [];
  const drawn = mine?.drawn ?? null;
  const [sheet, setSheet] = useState<"log" | null>(null);
  const [player, setPlayer] = useState<number | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [pending, run] = usePending();
  const send = useMutation(api.uno.move);
  const active = match.status === "active";
  const playing = seat >= 0 && active && !isOutOfHand(state, seat);
  const myTurn = playing && state.turn === seat;
  const [uno, setUno] = useState(false);
  const unoKey = `${state.hand}:${cards.length}`;
  const [unoFor, setUnoFor] = useState(unoKey);
  if (unoFor !== unoKey) {
    setUnoFor(unoKey);
    setUno(false);
  }
  const unoReady =
    playing && state.rules.unoCall && cards.some((c) => leftAfter(cards, c) === 1 && cantPlay(state, seat, c, cards, drawn) === null);
  useLive(match, state, seat);

  const move = (m: Move) =>
    run(() =>
      send({ id: match._id, ...m, seq: m.seq ?? state.seq }).then(
        () => void toast.dismiss("uno-play"),
        (err: unknown) => {
          sfx("invalid");
          throw err;
        },
      ),
    );

  const tap = (card: Card) => {
    if (!playing || pending) return;
    const why = cantPlay(state, seat, card, cards, drawn);
    if (why) {
      sfx("invalid");
      toast.error(why, { id: "uno-play" });
      return;
    }
    if (isWild(card) && faceOf(card) !== "WC") return setAsk({ card, need: "color", seq: state.seq });
    if (state.rules.sevenZero && faceOf(card) === "7" && cards.length > 1) return setAsk({ card, need: "target", seq: state.seq });
    sfx("play");
    void move({ kind: "play", card, uno });
  };
  const finish = (extra: { color?: Color; target?: number }) => {
    if (!ask) return;
    const { card, seq } = ask;
    setAsk(null);
    sfx("play");
    void move({ kind: "play", card, uno, seq, ...extra });
  };

  const seats = <Seats match={match} state={state} seat={seat} onPlayer={setPlayer} />;
  const table = (
    <Table
      match={match}
      state={state}
      seat={seat}
      canDraw={myTurn && !cantDraw(state, seat, cards)}
      onDraw={() => void move({ kind: "draw" })}
    />
  );
  const dock = !active ? (
    <Result match={match} meId={meId} />
  ) : seat < 0 ? (
    <DockNote>You&rsquo;re watching</DockNote>
  ) : isGone(state, seat) ? (
    <DockNote>You&rsquo;re out of this one</DockNote>
  ) : (
    <Dock
      match={match}
      state={state}
      seat={seat}
      meId={meId}
      cards={cards}
      drawn={drawn}
      loaded={mine !== undefined}
      pending={pending}
      uno={uno}
      unoReady={unoReady}
      onUno={() => setUno((u) => !u)}
      onTap={tap}
      move={move}
    />
  );
  return (
    <GameFrame tight dock={dock}>
      {seats}
      <TopLine state={state} seat={seat} onLog={() => setSheet("log")} />
      {table}
      <ColorSheet open={ask?.need === "color"} card={ask?.card} onClose={() => setAsk(null)} onPick={(color) => finish({ color })} />
      <SwapSheet
        open={ask?.need === "target"}
        match={match}
        state={state}
        seat={seat}
        onClose={() => setAsk(null)}
        onPick={(target) => finish({ target })}
      />
      <LogSheet open={sheet === "log"} onClose={() => setSheet(null)} match={match} state={state} seat={seat} />
      <PlayerSheet seat={player} me={seat} match={match} state={state} onClose={() => setPlayer(null)} move={move} />
    </GameFrame>
  );
}

function useLive(match: MatchView, state: UnoState, seat: number) {
  const prev = useRef(state);
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (was === state || was.seq === state.seq) return;
    const fresh = state.log.filter((e) => e.seq > was.seq && e.seat !== seat);
    const names = (i: number) => (i === seat ? "you" : (match.players[i]?.name ?? "Someone"));
    for (const e of fresh) {
      if (e.kind === "play" || e.kind === "jump") sfx("play", { live: true });
      else if (e.kind === "uno") sfx("knock", { live: true });
      else if (e.kind === "swap" || e.kind === "rotate") sfx("shuffle", { live: true });
      else if (e.kind === "draw") sfx("deal", { live: true });
    }
    const hits = state.log.filter(
      (e) =>
        e.seq > was.seq &&
        ((e.kind === "take" &&
          e.seat === seat &&
          e.n &&
          state.log.some((x) => x.seq === e.seq && x.seat !== seat && (x.kind === "play" || x.kind === "jump"))) ||
          (e.kind === "catch" && e.target === seat) ||
          (e.kind === "swap" && e.target === seat) ||
          (e.kind === "challenge" && e.guilty && e.target === seat)),
    );
    for (const e of hits) {
      sfx("slam", { live: true });
      const by = state.log.find((x) => x.seq === e.seq && (x.kind === "play" || x.kind === "jump"))?.seat ?? e.seat;
      const text = e.kind === "take" ? `+${e.n} from ${names(by)}` : entryText(e, names);
      toast(text[0].toUpperCase() + text.slice(1), { id: `uno-hit-${e.seq}` });
    }
    const rotated = state.log.find((e) => e.seq > was.seq && e.kind === "rotate" && e.seat !== seat);
    if (rotated && seat >= 0)
      toast(`${names(rotated.seat)} passed every hand along. You have ${state.counts[seat]} now.`, { id: `uno-rotate-${rotated.seq}` });
    if (state.turn === seat && was.turn !== seat && state.hand === was.hand) sfx("turn", { live: true });
  }, [state, seat, match.players]);
  const wasOver = useRef(match.status === "finished");
  useEffect(() => {
    if (match.status !== "finished" || wasOver.current) return;
    wasOver.current = true;
    if (seat >= 0) sfx(match.result?.winners.includes(match.players[seat].userId) ? "win" : "lose");
  }, [match.status, match.result, match.players, seat]);
}

function TopLine({ state, seat, onLog }: { state: UnoState; seat: number; onLog: () => void }) {
  const goal = state.rules.goal;
  return (
    <div className="flex h-11 items-center justify-between gap-2 px-1">
      <p className="flex items-center gap-2 text-footnote text-muted-foreground tabular-nums">
        <span className="font-semibold text-foreground" data-hand={state.hand}>
          Hand {state.hand}
        </span>
        <span>{goal ? `Play to ${goal}` : "One hand"}</span>
        {goal > 0 && seat >= 0 && <span>{state.scores[seat]} pts</span>}
      </p>
      <Button variant="ghost" size="sm" className="-mr-2 gap-1 text-muted-foreground" onClick={onLog} disabled={!state.log.length}>
        Log <CaretRightIcon weight="bold" />
      </Button>
    </div>
  );
}

function Seats({ match, state, seat, onPlayer }: { match: MatchView; state: UnoState; seat: number; onPlayer: (seat: number) => void }) {
  return (
    <div
      className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 phone-landscape:mx-0 phone-landscape:flex-wrap phone-landscape:justify-center phone-landscape:px-0"
      aria-label="Players"
    >
      {match.players.map((pl, i) => {
        const out = isOutOfHand(state, i);
        const up = state.turn === i && match.status === "active";
        const count = state.counts[i];
        return (
          <Button
            key={i}
            variant="bare"
            size="chip"
            data-seat={i}
            data-count={count}
            data-up={up || undefined}
            onClick={() => onPlayer(i)}
            aria-label={`${i === seat ? "You" : pl.name}: ${out ? "out" : `${count} cards`}`}
            className={cn(
              "relative shrink-0 rounded-full py-1 pl-1 pr-3 transition-colors duration-150",
              up ? "bg-primary/20 ring-2 ring-primary" : "bg-muted/60",
              out && "opacity-45",
            )}
          >
            <PlayerAvatar player={pl} size={32} seat={seatColor(pl, out)} />
            <span className="flex flex-col leading-tight">
              <span className="flex items-center gap-1 font-display text-callout tabular-nums">
                <CardsIcon size={14} weight="fill" className="text-muted-foreground" />
                {out ? "out" : count}
              </span>
              <span className="flex h-3.5 items-center gap-1 text-caption text-muted-foreground tabular-nums">
                {count === 1 && !out ? (
                  <span className={cn("font-semibold", state.forgot === i ? "text-destructive" : "text-primary")}>
                    {state.forgot === i ? "No UNO!" : "UNO"}
                  </span>
                ) : state.rules.goal ? (
                  `${state.scores[i]} pts`
                ) : (
                  <span className="max-w-14 truncate">{i === seat ? "You" : pl.name}</span>
                )}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function Table({
  match,
  state,
  seat,
  canDraw,
  onDraw,
}: {
  match: MatchView;
  state: UnoState;
  seat: number;
  canDraw: boolean;
  onDraw: () => void;
}) {
  const last = state.log.at(-1);
  const name = (i: number) => (i === seat ? "you" : (match.players[i]?.name ?? "Someone"));
  const p = state.pending;
  const after = state.turn >= 0 ? next(state, state.turn) : -1;
  const lastText = last ? entryText(last, name) : "";
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-1"
      data-top={state.top}
      data-color={state.color}
      data-seq={state.seq}
    >
      <div className="flex items-center gap-8">
        <div className="flex flex-col items-center gap-1.5">
          <Button
            variant="bare"
            size="overlay"
            aria-label={canDraw ? "Draw a card" : "Draw pile"}
            disabled={!canDraw}
            onClick={onDraw}
            className={cn("relative rounded-md", canDraw && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
          >
            <UnoCard width={60} className="absolute left-1 top-1 opacity-60" />
            <UnoCard width={60} />
          </Button>
          <span className="text-caption text-muted-foreground tabular-nums">{state.left} left</span>
        </div>
        <div className="relative flex flex-col items-center gap-1.5">
          <div
            className="relative rounded-md p-1 transition-shadow duration-300"
            style={{ boxShadow: `0 0 0 3px var(--color-uno-${state.color}), 0 0 22px var(--color-uno-${state.color})` }}
            aria-label={`${COLOR_NAME[state.color]} is up`}
            data-pile
          >
            {state.recent.length > 1 && (
              <span aria-hidden="true" className="absolute left-1 top-1 rotate-[-8deg] opacity-70">
                <UnoCard card={state.recent.at(-2)} width={84} />
              </span>
            )}
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={`${state.hand}:${state.recent.length}:${last?.seq ?? 0}:${state.top}`}
                initial={{ y: -60, rotate: -18, scale: 1.15, opacity: 0 }}
                animate={{ y: 0, rotate: 0, scale: 1, opacity: 1 }}
                transition={{ type: "spring", bounce: 0.25, duration: 0.45 }}
                className="relative"
              >
                <UnoCard card={state.top} width={84} chosen={isWild(state.top) ? state.color : undefined} />
              </motion.div>
            </AnimatePresence>
          </div>
          <span className="flex items-center gap-1 text-caption text-muted-foreground">
            <motion.span
              animate={{ rotate: state.dir === 1 ? 0 : 180, scaleX: state.dir === 1 ? 1 : -1 }}
              transition={{ type: "spring", bounce: 0 }}
            >
              <ArrowsClockwiseIcon size={13} weight="bold" />
            </motion.span>
            <span data-up-color={state.color}>{COLOR_NAME[state.color]}</span>
            {after >= 0 && !state.over ? ` · next: ${name(after)}` : ""}
          </span>
          <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center">
            <AnimatePresence>
              {p && (
                <motion.span
                  key={p.kind}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ type: "spring", bounce: 0.5 }}
                  className="whitespace-nowrap rounded-full bg-destructive px-3 py-1 shadow-md font-display text-callout text-destructive-foreground"
                  data-pending={p.kind === "draw" ? p.amount : "roulette"}
                >
                  <motion.span
                    key={p.kind === "draw" ? p.amount : 0}
                    className="inline-block"
                    initial={{ scale: 1.4 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", bounce: 0.5 }}
                  >
                    {p.kind === "draw" ? `+${p.amount} on ${name(state.turn)}` : `Roulette for ${name(state.turn)}`}
                  </motion.span>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <p className="h-5 max-w-full truncate px-2 text-center text-footnote text-muted-foreground" data-last={last?.kind}>
        {lastText ? lastText[0].toUpperCase() + lastText.slice(1) : ""}
      </p>
    </div>
  );
}

function Dock({
  match,
  state,
  seat,
  meId,
  cards,
  drawn,
  loaded,
  pending,
  uno,
  unoReady,
  onUno,
  onTap,
  move,
}: {
  match: MatchView;
  state: UnoState;
  seat: number;
  meId: Id<"users"> | undefined;
  cards: Card[];
  drawn: Card | null;
  loaded: boolean;
  pending: boolean;
  uno: boolean;
  unoReady: boolean;
  onUno: () => void;
  onTap: (card: Card) => void;
  move: (m: Move) => Promise<void>;
}) {
  const myTurn = state.turn === seat && !isOutOfHand(state, seat);
  const p = state.pending;
  const forgot = state.forgot;
  const up = match.players[state.turn];
  let banner;
  if (forgot === seat)
    banner = (
      <Button
        size="lg"
        variant="destructive"
        className="w-full"
        icon={<MegaphoneIcon weight="fill" />}
        pending={pending}
        onClick={() => void move({ kind: "uno" })}
      >
        Call UNO before they catch you
      </Button>
    );
  else if (forgot !== null && !isOutOfHand(state, seat))
    banner = (
      <Button
        size="lg"
        className="w-full"
        icon={<SirenIcon weight="fill" />}
        pending={pending}
        onClick={() => void move({ kind: "catch", target: forgot })}
      >
        Catch {match.players[forgot]?.name}: no UNO
      </Button>
    );
  else if (isOutOfHand(state, seat)) banner = <Note>The mercy rule got you. Back next hand.</Note>;
  else
    banner = (
      <Note>
        {myTurn ? (
          p?.kind === "draw" ? (
            p.challenge ? (
              "Take them or challenge"
            ) : (
              "Stack a draw card or take them"
            )
          ) : p?.kind === "roulette" ? (
            "Pick a color to spin for"
          ) : state.drew ? (
            "Play the card you drew?"
          ) : (
            "Your move"
          )
        ) : (
          <TurnText up={up} meId={meId} />
        )}
      </Note>
    );

  let actions;
  if (!myTurn) actions = null;
  else if (p?.kind === "roulette")
    actions = (
      <div role="group" aria-label="Spin for" className="grid grid-cols-4 gap-2">
        {COLORS.map((c) => (
          <Button
            key={c}
            size="xl"
            variant="bare"
            className="w-full rounded-lg px-1 font-display text-body text-paper phone-landscape:text-footnote"
            style={{ background: `var(--color-uno-${c})` }}
            pending={pending}
            onClick={() => void move({ kind: "roulette", color: c })}
          >
            {COLOR_NAME[c]}
          </Button>
        ))}
      </div>
    );
  else if (p?.kind === "draw")
    actions = (
      <>
        <Button size="xl" variant="destructive" className="w-full" pending={pending} onClick={() => void move({ kind: "take" })}>
          Take {p.amount}
        </Button>
        {p.challenge && (
          <Button size="xl" variant="secondary" className="w-full" pending={pending} onClick={() => void move({ kind: "challenge" })}>
            Challenge
          </Button>
        )}
      </>
    );
  else if (state.drew)
    actions = canPass(state, seat) ? (
      <Button size="xl" variant="secondary" className="w-full" pending={pending} onClick={() => void move({ kind: "pass" })}>
        Keep it
      </Button>
    ) : null;
  else {
    const why = cantDraw(state, seat, cards);
    actions = (
      <Button
        size="xl"
        variant="secondary"
        className="w-full"
        icon={<CardsIcon weight="fill" />}
        disabled={!!why}
        pending={pending}
        onClick={() => void move({ kind: "draw" })}
      >
        {why && state.rules.forcePlay ? "You have a play" : state.rules.drawUntil ? "Draw till I can" : "Draw"}
      </Button>
    );
  }
  const unoToggle = unoReady ? (
    <Button
      size="xl"
      variant={uno ? "default" : "outline"}
      className="w-full font-display"
      aria-pressed={uno}
      icon={<MegaphoneIcon weight={uno ? "fill" : "regular"} />}
      onClick={() => {
        sfx(uno ? "recall" : "knock");
        onUno();
      }}
    >
      UNO!
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-11 items-center">{banner}</div>
      <Hand state={state} seat={seat} cards={cards} drawn={drawn} loaded={loaded} onTap={onTap} />
      <ActionRail className="h-14 phone-landscape:h-auto">
        {unoToggle}
        {actions}
        {!actions && !unoToggle && <span />}
      </ActionRail>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="flex w-full items-center justify-center gap-2 text-center text-callout text-muted-foreground">{children}</p>;
}

function Hand({
  state,
  seat,
  cards,
  drawn,
  loaded,
  onTap,
}: {
  state: UnoState;
  seat: number;
  cards: Card[];
  drawn: Card | null;
  loaded: boolean;
  onTap: (card: Card) => void;
}) {
  const two = cards.length > 6;
  const width = two ? 44 : 56;
  const ok = new Set(cards.filter((c) => cantPlay(state, seat, c, cards, drawn) === null));
  const myTurn = state.turn === seat;
  return (
    <div
      className={cn("-mx-3 overflow-x-auto px-3 phone-landscape:mx-0 phone-landscape:px-0", HAND_HEIGHT)}
      aria-label="Your hand"
      role="group"
      aria-busy={!loaded || undefined}
      data-cards={cards.length}
    >
      <div
        className={cn(
          "mx-auto grid h-full w-max auto-cols-max grid-flow-col content-center gap-1 py-1.5",
          two ? "grid-rows-2" : "grid-rows-1",
        )}
      >
        <AnimatePresence initial={false}>
          {cards.map((card, i) => {
            const can = ok.has(card);
            const lift = can && (myTurn || state.rules.jumpIn);
            return (
              <motion.div
                key={`${card}:${cards.slice(0, i).filter((c) => c === card).length}`}
                layout
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: lift ? -3 : 0, opacity: 1 }}
                exit={{ y: -40, opacity: 0, transition: { duration: 0.15 } }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.35 }}
              >
                <Button
                  variant="bare"
                  size="piece"
                  data-card={card}
                  data-playable={can || undefined}
                  aria-label={can ? `Play ${cardName(card)}` : cardName(card)}
                  onClick={() => onTap(card)}
                  className={cn("rounded-sm", drawn === card && myTurn && "ring-2 ring-primary ring-offset-1 ring-offset-background")}
                >
                  <UnoCard card={card} width={width} dim={myTurn && !can} />
                </Button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ColorSheet({ open, card, onClose, onPick }: { open: boolean; card?: Card; onClose: () => void; onPick: (c: Color) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Pick a color" closable>
      <div className="flex items-center justify-center pb-2">{card && <UnoCard card={card} width={72} />}</div>
      <div className="grid grid-cols-2 gap-2">
        {COLORS.map((c) => (
          <Button
            key={c}
            size="xl"
            variant="bare"
            className="w-full rounded-lg font-display text-body text-paper"
            style={{ background: `var(--color-uno-${c})` }}
            onClick={() => onPick(c)}
          >
            {COLOR_NAME[c]}
          </Button>
        ))}
      </div>
    </Sheet>
  );
}

function SwapSheet({
  open,
  match,
  state,
  seat,
  onClose,
  onPick,
}: {
  open: boolean;
  match: MatchView;
  state: UnoState;
  seat: number;
  onClose: () => void;
  onPick: (seat: number) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Swap hands with" closable>
      <div className="flex flex-col gap-2">
        {inHand(state)
          .filter((i) => i !== seat)
          .map((i) => (
            <Button key={i} variant="secondary" size="option" className="h-14 w-full justify-start gap-3 px-3" onClick={() => onPick(i)}>
              <PlayerAvatar player={match.players[i]} size={36} seat={seatColor(match.players[i])} />
              <span className="flex-1 text-left text-body">{match.players[i].name}</span>
              <span className="flex items-center gap-1 font-display text-body tabular-nums">
                <CardsIcon weight="fill" className="text-muted-foreground" />
                {state.counts[i]}
              </span>
            </Button>
          ))}
      </div>
    </Sheet>
  );
}

function LogSheet({
  open,
  onClose,
  match,
  state,
  seat,
}: {
  open: boolean;
  onClose: () => void;
  match: MatchView;
  state: UnoState;
  seat: number;
}) {
  const name = (i: number) => (i === seat ? "you" : (match.players[i]?.name ?? "Someone"));
  const entries = [...state.log].reverse();
  const last = state.last;
  return (
    <Sheet open={open} onClose={onClose} title="What happened" closable>
      {last && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-callout">
          {`${name(last.winner)[0].toUpperCase()}${name(last.winner).slice(1)} won hand ${last.hand} for ${last.points} points`}
        </p>
      )}
      <ul className="flex flex-col gap-1.5 text-callout">
        {entries.map((e) => {
          const text = entryText(e, name);
          return (
            <li key={`${e.seq}:${e.kind}:${e.seat}`} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
              {e.card ? <UnoCard card={e.card} width={22} chosen={e.color} /> : <span className="w-[22px]" />}
              <span className="flex-1">{text[0].toUpperCase() + text.slice(1)}</span>
              {e.hand !== state.hand && <span className="text-caption text-muted-foreground">Hand {e.hand}</span>}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function PlayerSheet({
  seat,
  me,
  match,
  state,
  onClose,
  move,
}: {
  seat: number | null;
  me: number;
  match: MatchView;
  state: UnoState;
  onClose: () => void;
  move: (m: Move) => Promise<void>;
}) {
  const pl = seat === null ? null : match.players[seat];
  const out = seat !== null && isOutOfHand(state, seat);
  return (
    <Sheet open={seat !== null} onClose={onClose} title={pl ? (seat === me ? "You" : pl.name) : ""} closable>
      {pl && seat !== null && (
        <>
          <div className="flex items-center gap-3">
            <PlayerAvatar player={pl} size={56} seat={seatColor(pl, out)} />
            <div className="flex flex-col gap-0.5">
              <span className="font-display text-title tabular-nums">{out ? "Out" : `${state.counts[seat]} cards`}</span>
              {state.rules.goal > 0 && (
                <span className="text-footnote text-muted-foreground tabular-nums">
                  {state.scores[seat]} of {state.rules.goal} points
                </span>
              )}
            </div>
          </div>
          {state.forgot === seat && seat !== me && me >= 0 && !isOutOfHand(state, me) && (
            <Button
              size="xl"
              className="w-full"
              icon={<SirenIcon weight="fill" />}
              onClick={() => void move({ kind: "catch", target: seat }).then(onClose)}
            >
              Catch them: +2
            </Button>
          )}
          {seat === me && match.status === "active" && !isGone(state, me) && (
            <ResignButton match={match} detail="You'll drop to last and the game goes on without you." className="w-full" size="lg" />
          )}
        </>
      )}
    </Sheet>
  );
}
