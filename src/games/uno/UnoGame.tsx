import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowFatUpIcon, CardsIcon, FastForwardIcon, MegaphoneIcon, SirenIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { COLORS, COLOR_NAME, colorOf, deckOf, faceOf, isWild, sortHand, type Card, type Color } from "../../../convex/uno/cards";
import { canPass, cantDraw, cantPlay, inHand, isGone, isOutOfHand, type UnoState } from "../../../convex/uno/engine";
import { entryText } from "../../../convex/uno/text";
import { usePending } from "@/components/AsyncButton";
import { ActionRail, DockNote, GameFrame, InMenu } from "@/components/game/GameFrame";
import { usePhoneLandscape } from "@/components/game/landscape";
import { ResignButton, Result } from "@/components/match";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { SectionTitle } from "@/components/parts";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { sfx } from "@/sound";
import { UnoCard } from "./Card";
import { geometry, useFx, type P } from "./fx";
import { Hand } from "./Hand";
import { useShow } from "./show";
import { Table } from "./Table";

type Move = {
  kind: "play" | "draw" | "pass" | "take" | "challenge" | "roulette" | "catch" | "uno";
  card?: Card;
  color?: Color;
  target?: number;
  uno?: boolean;
  seq?: number;
};
type Ask = { card: Card; need: "color" | "target"; seq: number };

const drawable = (s: UnoState) => deckOf(s.rules.deck, s.rules.decks).length - s.counts.reduce((a, b) => a + b, 0) - 1;

const leftAfter = (cards: Card[], card: Card) =>
  faceOf(card) === "DA" ? cards.filter((c) => isWild(c) || colorOf(c) !== colorOf(card)).length : cards.length - 1;

export default function UnoGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const state = match.state as UnoState;
  const seat = match.players.findIndex((p) => p.userId === meId);
  const shown = useShow({ id: match._id, real: state, mySeat: seat });
  const view = shown.state;
  const mine = useQuery(api.uno.hand, seat >= 0 ? { id: match._id } : "skip");
  const cards = mine && mine.hand === state.hand ? sortHand(mine.cards, state.rules.deck) : [];
  const drawn = mine?.drawn ?? null;
  const [player, setPlayer] = useState<number | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [picked, setPicked] = useState<{ card: Card; seq: number; rect: DOMRect } | null>(null);
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
  const chosen =
    playing && picked && picked.seq === state.seq && cantPlay(state, seat, picked.card, cards, drawn) === null ? picked.card : null;
  const landscape = usePhoneLandscape();
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onBox = useCallback((b: { w: number; h: number }) => setBox((was) => (was && was.w === b.w && was.h === b.h ? was : b)), []);
  const n = match.players.length;
  const geo = useMemo(() => {
    if (!box) return null;
    const order = seat >= 0 ? Array.from({ length: n - 1 }, (_, k) => (seat + 1 + k) % n) : Array.from({ length: n }, (_, k) => k);
    return geometry(box.w, box.h, order);
  }, [box, seat, n]);
  const tappedRef = useRef<{ card: Card; at: P } | null>(null);
  const names = useCallback((i: number) => (i === seat ? "you" : (match.players[i]?.name ?? "Someone")), [seat, match.players]);
  const fx = useFx({ view, jumped: shown.jumped, me: seat, geo, names, tappedRef });
  const lastEntry = view.log.at(-1);
  const last = lastEntry ? <LastLine kind={lastEntry.kind}>{cap(entryText(lastEntry, names))}</LastLine> : null;
  useFinish(match, seat);

  const move = (m: Move) => {
    if (shown.catching) shown.skip();
    return run(() =>
      send({ id: match._id, ...m, seq: m.seq ?? state.seq }).then(
        () => void toast.dismiss("uno-play"),
        (err: unknown) => {
          sfx("invalid");
          throw err;
        },
      ),
    );
  };

  const tap = (card: Card, rect: DOMRect) => {
    if (!playing || pending) return;
    if (chosen === card) return setPicked(null);
    const why = cantPlay(state, seat, card, cards, drawn);
    if (why) {
      sfx("invalid");
      toast.error(why, { id: "uno-play" });
      return;
    }
    sfx("deal");
    toast.dismiss("uno-play");
    setPicked({ card, seq: state.seq, rect });
  };
  const play = () => {
    if (!chosen || !picked) return;
    const card = chosen;
    const rect = picked.rect;
    setPicked(null);
    const b = boxRef.current?.getBoundingClientRect();
    if (b) tappedRef.current = { card, at: { x: rect.left + rect.width / 2 - b.left, y: rect.top + rect.height / 2 - b.top } };
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
  const origin = (from: number, card: Card): P => {
    if (!geo) return { x: 0, y: 0 };
    if (from === seat) return tappedRef.current?.card === card ? tappedRef.current.at : geo.me;
    return geo.seats.get(from) ?? geo.c;
  };

  const dock = shown.catching ? (
    <div className="flex h-[200px] flex-col items-center justify-center gap-3 phone-landscape:h-auto">
      <div className="flex h-11 w-full items-center">{last}</div>
      <Button size="xl" variant="secondary" className="w-full" icon={<FastForwardIcon weight="fill" />} onClick={shown.skip}>
        Skip to now
      </Button>
    </div>
  ) : !active ? (
    <Result match={match} meId={meId} />
  ) : seat < 0 ? (
    last ? (
      <div className="flex h-[60px] items-center">{last}</div>
    ) : (
      <DockNote>You&rsquo;re watching</DockNote>
    )
  ) : isGone(state, seat) ? (
    <DockNote>You&rsquo;re out of this one</DockNote>
  ) : (
    <Dock
      match={match}
      state={state}
      seat={seat}
      cards={cards}
      drawn={drawn}
      chosen={chosen}
      onPlay={play}
      loaded={mine !== undefined}
      pending={pending}
      uno={uno}
      unoReady={unoReady}
      last={last}
      cardW={landscape ? 58 : 80}
      shake={fx.shake}
      onUno={() => setUno((u) => !u)}
      onTap={tap}
      move={move}
    />
  );
  return (
    <GameFrame tight dock={dock}>
      <Table
        boxRef={boxRef}
        match={match}
        state={view}
        seat={seat}
        geo={geo}
        fx={fx}
        canDraw={myTurn && !cantDraw(state, seat, cards)}
        onDraw={() => void move({ kind: "draw" })}
        onBox={onBox}
        onPlayer={setPlayer}
        origin={origin}
        jumped={shown.jumped}
      />
      <ColorSheet open={ask?.need === "color"} card={ask?.card} onClose={() => setAsk(null)} onPick={(color) => finish({ color })} />
      <SwapSheet
        open={ask?.need === "target"}
        match={match}
        state={state}
        seat={seat}
        onClose={() => setAsk(null)}
        onPick={(target) => finish({ target })}
      />
      <InMenu>
        <UnoMenu match={match} state={state} seat={seat} />
      </InMenu>
      <PlayerSheet seat={player} me={seat} match={match} state={state} onClose={() => setPlayer(null)} move={move} />
    </GameFrame>
  );
}

function useFinish(match: MatchView, seat: number) {
  const wasOver = useRef(match.status === "finished");
  useEffect(() => {
    if (match.status !== "finished" || wasOver.current) return;
    wasOver.current = true;
    if (seat >= 0) sfx(match.result?.winners.includes(match.players[seat].userId) ? "win" : "lose");
  }, [match.status, match.result, match.players, seat]);
}

function Dock({
  match,
  state,
  seat,
  cards,
  drawn,
  chosen,
  onPlay,
  loaded,
  pending,
  uno,
  unoReady,
  last,
  cardW,
  shake,
  onUno,
  onTap,
  move,
}: {
  match: MatchView;
  state: UnoState;
  seat: number;
  cards: Card[];
  drawn: Card | null;
  chosen: Card | null;
  onPlay: () => void;
  loaded: boolean;
  pending: boolean;
  uno: boolean;
  unoReady: boolean;
  last: ReactNode;
  cardW: number;
  shake: number;
  onUno: () => void;
  onTap: (card: Card, rect: DOMRect) => void;
  move: (m: Move) => Promise<void>;
}) {
  const myTurn = state.turn === seat && !isOutOfHand(state, seat);
  const p = state.pending;
  const forgot = state.forgot;
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
  else if (myTurn && p?.kind === "draw") banner = <Note>{p.challenge ? "Take them or challenge" : "Stack a draw card or take them"}</Note>;
  else if (myTurn && p?.kind === "roulette") banner = <Note>Name a color: you flip till you hit it</Note>;
  else if (myTurn && state.drew)
    banner = <Note>{canPass(state, seat) ? "Play the card you drew, or keep it" : "Play the card you drew"}</Note>;
  else banner = last;

  let actions;
  if (chosen)
    actions = (
      <Button size="xl" className="w-full" icon={<ArrowFatUpIcon weight="fill" />} pending={pending} onClick={onPlay}>
        Play
      </Button>
    );
  else if (!myTurn) actions = null;
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
          {state.rules.mercy > 0 && cards.length + Math.min(p.amount, drawable(state)) >= state.rules.mercy ? " and go out" : ""}
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
      variant={uno ? "default" : "secondary"}
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
      <Hand
        cards={cards}
        playable={new Set(cards.filter((c) => cantPlay(state, seat, c, cards, drawn) === null))}
        myTurn={myTurn}
        drawn={drawn}
        chosen={chosen}
        loaded={loaded}
        cardW={cardW}
        shake={shake}
        onTap={onTap}
      />
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

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

function LastLine({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <p className="line-clamp-2 w-full text-center text-callout text-muted-foreground" data-last={kind}>
      {children}
    </p>
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

function UnoMenu({ match, state, seat }: { match: MatchView; state: UnoState; seat: number }) {
  const name = (i: number) => (i === seat ? "you" : (match.players[i]?.name ?? "Someone"));
  const entries = [...state.log].reverse();
  const last = state.last;
  return (
    <>
      {state.rules.goal > 0 && (
        <section aria-label="Scores">
          <SectionTitle className="pb-2">Hand {state.hand}</SectionTitle>
          <ol className="flex flex-col gap-1.5">
            {match.players
              .map((pl, i) => ({ pl, i }))
              .sort((a, b) => state.scores[b.i] - state.scores[a.i])
              .map(({ pl, i }) => (
                <li key={i} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
                  <PlayerAvatar player={pl} size={32} seat={seatColor(pl, isGone(state, i))} />
                  <span className="min-w-0 flex-1 truncate">{i === seat ? "You" : pl.name}</span>
                  <span className="font-display text-callout tabular-nums">
                    {state.scores[i]}
                    <span className="text-muted-foreground">/{state.rules.goal}</span>
                  </span>
                </li>
              ))}
          </ol>
        </section>
      )}
      {(last || entries.length > 0) && (
        <section aria-label="What happened">
          <SectionTitle className="pb-2">What happened</SectionTitle>
          <ol className="flex flex-col gap-1.5 text-callout">
            {last && (
              <li className="rounded-md bg-muted/50 px-3 py-2">{`${cap(name(last.winner))} won hand ${last.hand} for ${last.points}`}</li>
            )}
            {entries.map((e) => (
              <li key={`${e.seq}:${e.kind}:${e.seat}`} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                {e.card ? <UnoCard card={e.card} width={22} chosen={e.color} /> : <span className="w-[22px]" />}
                <span className="flex-1">{cap(entryText(e, name))}</span>
                {e.hand !== state.hand && <span className="text-caption text-muted-foreground">Hand {e.hand}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
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
