import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { CaretRightIcon, CheckIcon, StorefrontIcon, XIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import {
  ITEMS,
  LENGTH,
  cantGuess,
  cartCost,
  keyColors,
  lastWord,
  waitingOn,
  type Buy,
  type WordleState,
} from "../../../convex/wordle/engine";
import { buyLine } from "../../../convex/wordle/text";
import { GameFrame, DockNote } from "@/components/game/GameFrame";
import { usePhoneLandscape } from "@/components/game/landscape";
import { ResignButton, Result } from "@/components/match";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { errorText } from "@/lib/errors";
import { listNames } from "@/lib/text";
import { cn } from "@/lib/utils";
import { ThinkingDots, useHere } from "@/presence";
import { sfx } from "@/sound";
import { Tiles, type TileState } from "@/Tiles";
import { Board, FLIP_S, FLIP_STAGGER_S, type Row } from "./Board";
import { Hand } from "./Hand";
import { KEYBOARD_HEIGHT, Keyboard } from "./Keyboard";
import { Coins, ItemIcon, MARK_STATE, MiniBoard } from "./parts";
import { ShopSheet } from "./ShopSheet";

const TYPING_DEBOUNCE_MS = 250;
const INCOMING_MS = 5000;

type View = NonNullable<ReturnType<typeof useBoard>>;
const useBoard = (id: Id<"matches">) => useQuery(api.wordle.board, { id });

export default function WordleGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const state = match.state as WordleState;
  const view = useBoard(match._id);
  const seat = match.players.findIndex((p) => p.userId === meId);
  const landscape = usePhoneLandscape();
  const [sheet, setSheet] = useState<"shop" | "log" | null>(null);
  const [sheetRound, setSheetRound] = useState(state.round);
  if (sheetRound !== state.round) {
    setSheetRound(state.round);
    if (sheet === "shop") setSheet(null);
  }
  const me = seat >= 0 ? state.players[seat] : null;
  const shopping = !!me?.done && !me.out && state.rules.shop && !lastWord(state) && match.status === "active";
  const [player, setPlayer] = useState<number | null>(null);
  const names = (i: number) => (i === seat ? "you" : (match.players[i]?.name ?? "someone"));
  useLive(match, state, seat);

  const spending = me?.picked || sheet === "shop" ? cartCost(view?.cart ?? []) : 0;
  const top = <TopLine state={state} seat={seat} spending={spending} onLog={() => setSheet("log")} />;
  const players = <Players match={match} state={state} seat={seat} view={view} onPlayer={setPlayer} />;
  const play = usePlay(match, state, seat, view, () => setSheet("shop"));
  const dock = match.status === "finished" ? <Result match={match} meId={meId} /> : play.dock;
  return (
    <GameFrame tight aside={landscape ? play.board : undefined} dock={landscape ? null : dock}>
      {top}
      {players}
      {landscape ? dock : play.board}
      {seat >= 0 && view?.round === state.round && view.left && (
        <ShopSheet
          key={`${state.round}:${sheet === "shop"}`}
          open={sheet === "shop" && shopping}
          onClose={() => setSheet(null)}
          match={match}
          state={state}
          seat={seat}
          saved={view.cart}
          left={view.left}
          lost={view.lost}
          held={view.hand.length}
        />
      )}
      <LogSheet open={sheet === "log"} onClose={() => setSheet(null)} match={match} state={state} name={names} />
      <PlayerSheet seat={player} onClose={() => setPlayer(null)} match={match} state={state} me={seat} view={view} />
    </GameFrame>
  );
}

function useLive(match: MatchView, state: WordleState, seat: number) {
  const prev = useRef(state);
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (was === state) return;
    if (state.round !== was.round) {
      sfx("turn", { live: true });
      return;
    }
    state.players.forEach((p, i) => {
      const q = was.players[i];
      if (i === seat || !q) return;
      if (p.done && !q.done) sfx(p.won ? "knock" : "ghost", { live: true });
      else if (p.rows > q.rows) sfx("tick", { live: true });
    });
  }, [state, seat]);
  const wasOver = useRef(match.status === "finished");
  useEffect(() => {
    if (match.status !== "finished" || wasOver.current) return;
    wasOver.current = true;
    if (seat >= 0) sfx(match.result?.winners.includes(match.players[seat].userId) ? "win" : "lose");
  }, [match.status, match.result, match.players, seat]);
}

const NO_VIEW: View = {
  round: -1,
  seat: -1,
  rows: [],
  hint: null,
  hints: [],
  clue: null,
  clues: "",
  hand: [],
  pick: null,
  cart: [],
  lost: [],
  left: null,
  jammed: "",
  others: [],
  typing: [],
};

function usePlay(match: MatchView, state: WordleState, seat: number, loaded: View | null | undefined, onShop: () => void) {
  const view = loaded ?? NO_VIEW;
  const me = seat >= 0 ? state.players[seat] : null;
  const active = match.status === "active" && !!me && !me.out && view.round === state.round;
  const typing = active && !me.done;
  const [typed, setTyped] = useState("");
  const [shake, setShake] = useState(0);
  const [sending, setSending] = useState(false);
  const send = useMutation(api.wordle.guess);
  const tell = useMutation(api.wordle.typing);
  const roundRow = `${state.round}:${me?.rows ?? 0}`;
  const [typedFor, setTypedFor] = useState(roundRow);
  if (typedFor !== roundRow) {
    setTypedFor(roundRow);
    setTyped("");
  }

  useEffect(() => {
    if (!typing) return;
    const t = setTimeout(() => void tell({ id: match._id, letters: typed.length }).catch(() => {}), TYPING_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [typed.length, typing, tell, match._id]);

  const refuse = useCallback((why: string) => {
    sfx("invalid");
    setShake((n) => n + 1);
    toast.error(why, { id: "wordle-guess" });
  }, []);

  const letter = useCallback(
    (ch: string) => {
      if (!typing || sending) return;
      if (view.jammed.includes(ch)) return refuse(`${ch.toUpperCase()} is jammed for now.`);
      setTyped((t) => {
        if (t.length >= LENGTH) return t;
        sfx("pick");
        return t + ch;
      });
    },
    [typing, sending, view.jammed, refuse],
  );
  const back = useCallback(() => {
    if (!typing || sending) return;
    setTyped((t) => {
      if (t) sfx("recall");
      return t.slice(0, -1);
    });
  }, [typing, sending]);
  const enter = useCallback(() => {
    if (!typing || sending || !me) return;
    const why = cantGuess(state, seat, typed);
    if (why) return refuse(why === "Five letters." && typed.length < LENGTH ? "Not enough letters." : why);
    setSending(true);
    send({ id: match._id, word: typed, round: state.round, row: me.rows })
      .then((r) => {
        for (let i = 0; i < LENGTH; i++)
          setTimeout(() => sfx("flip", { count: Number(r.marks[i]) * 2 + 1 }), (i * FLIP_STAGGER_S + FLIP_S / 2) * 1000);
        const after = (LENGTH * FLIP_STAGGER_S + FLIP_S) * 1000;
        if (r.won) setTimeout(() => sfx("bingo"), after);
        else if (r.done) setTimeout(() => sfx("sweep"), after);
      })
      .catch((err) => refuse(errorText(err)))
      .finally(() => setSending(false));
  }, [typing, sending, me, state, seat, typed, send, match._id, refuse]);

  useEffect(() => {
    if (!typing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      if (e.key === "Enter") enter();
      else if (e.key === "Backspace") back();
      else if (/^[a-z]$/i.test(e.key)) letter(e.key.toLowerCase());
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typing, enter, back, letter]);

  const visible = view.rows.filter((r): r is Extract<Row, { letters: string }> => "letters" in r);
  const dark = me?.effects.some((e) => e.item === "dark") && !state.over;
  const colors = dark
    ? null
    : {
        ...Object.fromEntries([...view.clues].map((ch) => [ch, 1 as const])),
        ...keyColors(
          visible.map((r) => r.letters),
          visible.map((r) => r.marks),
        ),
      };
  const fog = me?.effects.find((e) => e.item === "fog");
  const rows = me ? me.max : 6;
  const board = (
    <div
      className={cn("relative flex min-h-0 flex-col phone-landscape:h-full", match.status === "finished" ? "h-[300px]" : "flex-1")}
      aria-busy={loaded === undefined || undefined}
    >
      <Board
        round={state.round}
        rows={rows}
        played={view.rows}
        typed={typed}
        typing={typing}
        hints={view.hints}
        shake={shake}
        won={!!me?.won}
        fogBy={fog ? (match.players[fog.by]?.name ?? null) : null}
        className="flex-1 py-1 contain-size"
      />
      {active && <Incoming key={state.round} match={match} state={state} seat={seat} />}
    </div>
  );
  const keyboard = <Keyboard colors={colors} jammed={view.jammed} disabled={sending} onLetter={letter} onEnter={enter} onBack={back} />;
  let dock;
  if (match.status !== "active") dock = null;
  else if (!me) dock = <DockNote className={KEYBOARD_HEIGHT}>Watching</DockNote>;
  else if (me.out) dock = <DockNote className={KEYBOARD_HEIGHT}>You&rsquo;re out of this one</DockNote>;
  else if (typing) dock = keyboard;
  else dock = <Done match={match} state={state} seat={seat} view={view} onShop={onShop} />;
  if (dock && me && !me.out && state.rules.shop)
    dock = (
      <div className="flex w-full flex-col">
        <Hand
          match={match}
          state={state}
          seat={seat}
          hand={view.hand}
          clues={view.clues}
          payday={me.effects.some((e) => e.item === "payday" && e.by === seat)}
          playing={typing}
          lastRow={typing && me.rows === me.max - 1}
        />
        {dock}
      </div>
    );
  return { board, dock };
}

function Done({
  match,
  state,
  seat,
  view,
  onShop,
}: {
  match: MatchView;
  state: WordleState;
  seat: number;
  view: View;
  onShop: () => void;
}) {
  const me = state.players[seat];
  const waiting = waitingOn(state).filter((i) => i !== seat);
  const shopOpen = state.rules.shop && !lastWord(state);
  const cart = view.cart;
  const first = cart[0];
  const pockets = me.effects.filter((e) => e.took);
  const pickText = !me.picked
    ? view.lost.length
      ? "Shop again"
      : "Shop"
    : first
      ? `${ITEMS[first.item].name}${ITEMS[first.item].target ? ` at ${match.players[first.target]?.name}` : ""}${cart.length > 1 ? ` + ${cart.length - 1} more` : ""}`
      : "Passing";
  return (
    <div
      className={cn("flex flex-col justify-between gap-1.5", KEYBOARD_HEIGHT, "phone-landscape:h-auto")}
      data-my-word={me.won ? "won" : "lost"}
    >
      <div className="flex items-center justify-between gap-2 text-callout">
        <span className="flex items-center gap-1.5 font-semibold">
          {me.won ? <CheckIcon weight="bold" className="text-[var(--tile-green)]" /> : <XIcon weight="bold" className="text-destructive" />}
          {`${me.won ? `Solved in ${me.rows}` : "Missed it"}`}
          {pockets.length > 0 && (
            <span className="font-normal text-muted-foreground">
              {pockets.map((e) => `${match.players[e.by]?.name} took ${e.took}`).join(", ")}
            </span>
          )}
        </span>
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", bounce: 0.5, delay: 0.9 }}
        >
          <Coins n={`+${me.earned}`} className="text-body" />
        </motion.span>
      </div>
      <div className="-mx-1 flex h-16 shrink-0 gap-3 overflow-x-auto px-1" aria-label="Their boards">
        {match.players.map((p, i) =>
          i === seat || state.players[i].out ? null : (
            <div key={i} className="flex shrink-0 flex-col items-center gap-1" data-board-of={i}>
              <MiniBoard marks={view.others[i] ?? []} rows={state.players[i].max} cell={7} label={`${p.name}'s colors`} />
              <span className="max-w-14 truncate text-caption text-muted-foreground">{p.name}</span>
            </div>
          ),
        )}
      </div>
      {shopOpen ? (
        <Button
          size="xl"
          variant={me.picked ? "secondary" : "default"}
          className="w-full"
          onClick={onShop}
          icon={<StorefrontIcon weight="fill" />}
        >
          <span className="min-w-0 truncate">{pickText}</span>
          <span className="ml-auto text-callout font-normal text-muted-foreground">
            <Coins n={me.coins - cartCost(view.cart)} className="text-foreground" /> left
          </span>
        </Button>
      ) : (
        <WaitingLine match={match} waiting={waiting} last />
      )}
      {shopOpen && <WaitingLine match={match} waiting={waiting} />}
    </div>
  );
}

function WaitingLine({ match, waiting, last }: { match: MatchView; waiting: number[]; last?: boolean }) {
  const one = waiting.length === 1 ? match.players[waiting[0]] : undefined;
  const { here } = useHere(one?.userId);
  const text = waiting.length ? `Waiting on ${listNames(waiting.map((i) => match.players[i].name))}` : "Everyone's in";
  return (
    <p
      className={cn("flex items-center justify-center gap-2 text-center text-footnote text-muted-foreground", last && "h-14 text-callout")}
    >
      {last && "Last word: most words, then fewest guesses. "}
      {text}
      {here && <ThinkingDots />}
    </p>
  );
}

function Incoming({ match, state, seat }: { match: MatchView; state: WordleState; seat: number }) {
  const buys = state.history.at(-1)?.buys ?? [];
  const mine = buys.filter((b) => b.target === seat && b.seat !== seat && b.got);
  const missed = buys.filter((b) => b.seat === seat && !b.got);
  const lines = [...mine, ...missed];
  const me = state.players[seat];
  const [shown, setShown] = useState(lines.length > 0 && me.rows === 0);
  const hits = mine.some((b) => !b.blocked);
  useEffect(() => {
    if (!shown) return;
    if (hits) sfx("slam", { live: true });
    const t = setTimeout(() => setShown(false), INCOMING_MS);
    return () => clearTimeout(t);
  }, [shown, hits]);
  const name = (i: number) => (i === seat ? "you" : (match.players[i]?.name ?? "someone"));
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          className="absolute inset-x-0 top-2 z-10 flex justify-center"
          initial={{ opacity: 0, y: -12, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.45 }}
        >
          <Button
            variant="bare"
            size="overlay"
            onClick={() => setShown(false)}
            aria-label="Incoming"
            data-incoming={lines.length}
            className="flex w-full max-w-sm flex-col gap-2 rounded-lg bg-popover p-3 text-left shadow-lg shadow-shade/25"
          >
            <Tiles word="HIT" states={hits ? ["hit", "hit", "hit"] : ["gray", "gray", "gray"]} size="sm" flip label="Incoming" />
            {lines.map((b: Buy, i) => (
              <span key={i} className="flex items-center gap-2 text-callout">
                <ItemIcon item={b.item} className={b.blocked || !b.got ? "text-muted-foreground" : "text-[var(--tile-hit)]"} />
                {cap(buyLine(b, name))}
                {b.item === "jam" &&
                  b.got &&
                  !b.blocked &&
                  `: ${(me.effects.find((e) => e.by === b.seat && e.item === "jam")?.letters ?? "").toUpperCase().split("").join(" ")}`}
              </span>
            ))}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

function TopLine({ state, seat, spending, onLog }: { state: WordleState; seat: number; spending: number; onLog: () => void }) {
  const me = seat >= 0 ? state.players[seat] : null;
  const word = state.over ? state.history.at(-1)?.word : null;
  return (
    <div className="flex h-11 items-center justify-between gap-2 px-1">
      <p className="flex items-center gap-2 text-footnote text-muted-foreground tabular-nums">
        <span className="font-semibold text-foreground" data-round={state.round}>
          {word ? `It was ${word.toUpperCase()}` : `Word ${state.round + 1}`}
        </span>
        <span>{state.rules.goal} words to win</span>
      </p>
      <div className="flex items-center gap-2">
        {me && (
          <span
            className="flex items-center gap-1 text-callout"
            data-coins={me.coins}
            data-after-shop={spending ? me.coins - spending : undefined}
          >
            <Coins n={me.coins} />
            {spending > 0 && <span className="text-footnote text-muted-foreground">{`→ ${me.coins - spending} after the shop`}</span>}
          </span>
        )}
        <Button variant="ghost" size="sm" className="-mr-2 gap-1 text-muted-foreground" onClick={onLog} disabled={!state.history.length}>
          Log <CaretRightIcon weight="bold" />
        </Button>
      </div>
    </div>
  );
}

function Players({
  match,
  state,
  seat,
  view,
  onPlayer,
}: {
  match: MatchView;
  state: WordleState;
  seat: number;
  view: View | undefined | null;
  onPlayer: (seat: number) => void;
}) {
  const typing = new Map((view?.typing ?? []).map((t) => [t.seat, t.letters]));
  return (
    <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 phone-landscape:flex-wrap" aria-label="Players">
      {state.players.map((p, i) => {
        const pl = match.players[i];
        const letters = typing.get(i) ?? 0;
        return (
          <Button
            key={i}
            variant="bare"
            size="chip"
            data-seat={i}
            data-solved={p.solved}
            data-rows={p.rows}
            data-done={p.done ? (p.won ? "won" : "lost") : undefined}
            onClick={() => onPlayer(i)}
            aria-label={`${i === seat ? "You" : pl.name}: ${p.solved} of ${state.rules.goal} solved`}
            className={cn(
              "relative shrink-0 rounded-full py-1 pl-1 pr-3 transition-colors duration-150",
              !p.done && !p.out && !state.over ? "bg-primary/15" : "bg-muted/60",
              p.out && "opacity-45",
            )}
          >
            <PlayerAvatar player={pl} size={32} seat={seatColor(pl, p.out)} />
            <span className="flex flex-col leading-tight">
              <span className="font-display text-callout tabular-nums">
                {p.solved}
                <span className="text-muted-foreground">/{state.rules.goal}</span>
              </span>
              <span className="flex h-3.5 items-center gap-1 text-caption text-muted-foreground tabular-nums">
                {p.done ? (
                  p.won ? (
                    <CheckIcon size={11} weight="bold" className="text-[var(--tile-green)]" />
                  ) : (
                    <XIcon size={11} weight="bold" className="text-destructive" />
                  )
                ) : (
                  <RowDots rows={p.rows} max={p.max} />
                )}
                {letters > 0 && !p.done && <ThinkingDots />}
                {p.effects
                  .filter((e) => e.by !== i)
                  .map((e, k) => (
                    <ItemIcon key={k} item={e.item} size={11} className="text-[var(--tile-hit)]" />
                  ))}
                {(p.shields ?? 0) > 0 && <ItemIcon item="shield" size={11} className="text-[var(--tile-green)]" />}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function RowDots({ rows, max }: { rows: number; max: number }) {
  return (
    <span className="flex gap-[2px]" aria-hidden="true">
      {Array.from({ length: max }, (_, r) => (
        <motion.span
          key={r}
          className={cn("size-1.5 rounded-full", r < rows ? "bg-foreground/70" : "bg-muted-foreground/30")}
          animate={r === rows - 1 ? { scale: [1.8, 1] } : undefined}
        />
      ))}
    </span>
  );
}

function LogSheet({
  open,
  onClose,
  match,
  state,
  name,
}: {
  open: boolean;
  onClose: () => void;
  match: MatchView;
  state: WordleState;
  name: (seat: number) => string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Words so far" closable>
      {[...state.history].reverse().map((h, k) => {
        const n = state.history.length - k;
        return (
          <section key={n} aria-label={`Word ${n}`} className="flex flex-col gap-3" data-log-word={h.word}>
            <div className="flex items-center gap-3">
              <span className="w-16 font-display text-callout text-muted-foreground">Word {n}</span>
              <Tiles word={h.word.toUpperCase()} states={Array(LENGTH).fill("green")} size="sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {h.boards.map((b, i) =>
                match.players[i] ? (
                  <div key={i} className="flex flex-col gap-1.5 rounded-lg bg-muted/50 p-2">
                    <span className="flex items-center gap-1.5 truncate text-footnote font-semibold">
                      <PlayerAvatar player={match.players[i]} size={20} seat={seatColor(match.players[i])} />
                      {match.players[i].name}
                      <span className="ml-auto font-normal text-muted-foreground">{b.won ? b.guesses.length : "X"}</span>
                    </span>
                    {b.guesses.map((g, r) => (
                      <Tiles
                        key={r}
                        word={g.toUpperCase()}
                        states={[...b.marks[r]].map((m) => MARK_STATE[Number(m)] as TileState)}
                        size="sm"
                      />
                    ))}
                  </div>
                ) : null,
              )}
            </div>
            {h.buys.length > 0 && (
              <ul className="flex flex-col gap-1.5 text-callout">
                {h.buys.map((b, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                    <ItemIcon item={b.item} className="shrink-0 text-muted-foreground" />
                    {cap(buyLine(b, name))}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </Sheet>
  );
}

function PlayerSheet({
  seat,
  onClose,
  match,
  state,
  me,
  view,
}: {
  seat: number | null;
  onClose: () => void;
  match: MatchView;
  state: WordleState;
  me: number;
  view: View | undefined | null;
}) {
  const p = seat === null ? null : state.players[seat];
  const pl = seat === null ? null : match.players[seat];
  const marks = seat === null ? null : seat === me ? null : view?.others[seat];
  return (
    <Sheet open={seat !== null} onClose={onClose} title={pl ? (seat === me ? "You" : pl.name) : ""} closable>
      {p && pl && seat !== null && (
        <>
          <div className="flex items-center gap-3">
            <PlayerAvatar player={pl} size={56} seat={seatColor(pl, p.out)} />
            <div className="flex flex-col gap-0.5">
              <span className="font-display text-title tabular-nums">
                {p.solved} of {state.rules.goal}
              </span>
              <span className="flex items-center gap-2 text-footnote text-muted-foreground">
                <Coins n={p.coins} /> · {p.guesses} guesses so far
              </span>
            </div>
          </div>
          {marks && <MiniBoard marks={marks} rows={p.max} cell={22} label={`${pl.name}'s colors`} className="self-center" />}
          {p.effects.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-callout">
              {p.effects.map((e, k) => (
                <li key={k} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                  <ItemIcon item={e.item} className={e.by === seat ? "text-[var(--tile-green)]" : "text-[var(--tile-hit)]"} />
                  {ITEMS[e.item].name}
                  {e.by !== seat && <span className="text-muted-foreground">from {match.players[e.by]?.name}</span>}
                  {e.took !== undefined && <span className="ml-auto text-muted-foreground">{`took ${e.took}`}</span>}
                </li>
              ))}
            </ul>
          )}
          {!p.done && !state.over && (
            <p className="text-callout text-muted-foreground">
              {p.rows} of {p.max} guesses used
            </p>
          )}
          {seat === me && match.status === "active" && !p.out && (
            <ResignButton match={match} detail="You'll drop to last and the words go on without you." className="w-full" size="lg" />
          )}
        </>
      )}
    </Sheet>
  );
}
