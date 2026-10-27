import { forwardRef, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  CaretLeftIcon,
  HandIcon,
  ListIcon,
  PencilSimpleIcon,
  ShuffleIcon,
  SkipForwardIcon,
  ToteSimpleIcon,
} from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { settingsOf, type ModeKey } from "../../../convex/modes";
import { bagLetters, evaluate, type Placement, type ScrabbleState, type Tile } from "../../../convex/scrabble/engine";
import { useGoBack } from "@/components/AppHeader";
import { AsyncButton } from "@/components/AsyncButton";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Rules } from "@/components/Rules";
import { ResignButton, ThinkingDots, useHere } from "@/components/match";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { OnlineDot } from "@/presence";
import { SEAT_COLORS } from "@/games/seats";
import { cn } from "@/lib/utils";
import { LetterTile } from "./Tile";
import { sfx } from "@/sound";
import { scrabbleRules } from "./rules";

// The pieces around the board in a game in progress, Letter League style: floating buttons over the board
// (back, whose turn, the menu), the menu with everyone's scores and the words played, and the bag.

const round = "grid size-11 shrink-0 place-items-center rounded-full bg-card/90 shadow-md backdrop-blur-md transition-transform duration-100 active:scale-[0.94]";

// Floats over the top of the board.
export const TopBar = forwardRef<HTMLDivElement, { match: MatchView; state: ScrabbleState; meId: Id<"users"> | undefined; myTurn: boolean; onMenu: () => void }>(function TopBar(
  { match, state, meId, myTurn, onMenu },
  ref,
) {
  const goBack = useGoBack("/");
  const up = match.players[state.turn];
  const { here } = useHere(up?.userId ?? ("" as Id<"users">));
  const last = state.moves.at(-1);
  const lastBy = last ? match.players[last.seat] : undefined;
  const lastText =
    !last || !lastBy ? null
    : last.kind === "play" ? `${lastBy.userId === meId ? "You" : lastBy.name}: ${last.words!.map((w) => w.word).join(", ")} +${last.score}`
    : `${lastBy.userId === meId ? "You" : lastBy.name} ${last.kind === "swap" ? `swapped ${last.count}` : last.kind === "pass" ? "passed" : last.kind === "timeout" ? "ran out of time" : "resigned"}`;
  return (
    <div ref={ref} className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+34px)] z-20 flex items-center gap-2 px-3">
      <button type="button" aria-label="Back" onClick={goBack} className={cn(round, "pointer-events-auto")}>
        <CaretLeftIcon size={22} weight="bold" />
      </button>
      <button
        type="button"
        onClick={onMenu}
        aria-label="Players and scores"
        // The whole pill is edged in the color of whoever's turn it is.
        className="pointer-events-auto flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border-2 bg-card/90 py-1 pl-1 pr-3 text-left shadow-md backdrop-blur-md transition-colors duration-300"
        style={{ borderColor: up ? SEAT_COLORS[up.color ?? ""] : "transparent" }}
      >
        {up && <PlayerAvatar name={up.name} image={up.image} frame={up.frame} frameColor={up.frameColor} size={34} className="shrink-0" />}
        <span className="min-w-0 flex-1">
          <motion.span
            key={myTurn ? "mine" : (up?.userId ?? "")}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn("flex items-center gap-1.5 truncate font-display text-callout leading-tight", myTurn && "text-primary")}
            aria-live="polite"
          >
            {myTurn ? "Your turn" : here ? `${up?.name} is on it` : `Waiting for ${up?.name}`}
            {!myTurn && here && <ThinkingDots />}
          </motion.span>
          {lastText && <span className="block truncate text-caption text-muted-foreground">{lastText}</span>}
        </span>
        {state.deadline !== null && <Countdown deadline={state.deadline} mine={myTurn} />}
      </button>
      <button type="button" aria-label="Menu" onClick={onMenu} className={cn(round, "pointer-events-auto")}>
        <ListIcon size={22} weight="bold" />
      </button>
    </div>
  );
});

export function Countdown({ deadline, mine }: { deadline: number; mine: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  // The last five seconds of your own turn tick.
  const ticked = useRef(left);
  useEffect(() => {
    if (mine && left !== ticked.current && left > 0 && left <= 5) sfx("tick");
    ticked.current = left;
  }, [left, mine]);
  const urgent = left <= 10;
  return (
    <span
      className={cn("shrink-0 rounded-full px-2.5 py-1 font-display text-callout tabular-nums", urgent ? "bg-[var(--tile-hit)] text-[var(--tile-hit-ink)]" : mine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
      aria-label={`${left} seconds left`}
    >
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

// The menu: everyone's score and who's up, the words played (tap one for its meaning), how to play, and
// resigning, well away from the buttons you tap all game.
export function GameMenu({
  open,
  onOpenChange,
  match,
  state,
  meId,
  planning,
  playing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  match: MatchView;
  state: ScrabbleState;
  meId: Id<"users"> | undefined;
  planning: { userId: Id<"users">; count: number }[] | undefined;
  playing: boolean;
}) {
  const plays = state.moves.map((m, i) => ({ m, i })).filter(({ m }) => m.kind === "play").reverse();
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="w-[86%] max-w-sm overflow-hidden" aria-describedby={undefined}>
        <div className="flex h-full flex-col overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-[calc(env(safe-area-inset-top)+34px)]">
          <DrawerHeader className="px-1 pb-3 text-left">
            <DrawerTitle className="font-display text-title">Players</DrawerTitle>
          </DrawerHeader>
          <ol className="flex flex-col gap-1.5" aria-label="Scores">
            {match.players
              .map((p, seat) => ({ p, seat }))
              .sort((a, b) => state.scores[b.seat] - state.scores[a.seat])
              .map(({ p, seat }) => (
                <PlayerRow key={p.userId} player={p} seat={seat} state={state} isMe={p.userId === meId} planning={planning?.find((x) => x.userId === p.userId)?.count ?? 0} />
              ))}
          </ol>
          <p className="px-1 pt-3 text-footnote text-muted-foreground">
            {state.bag} in the bag, round {state.round}
          </p>

          {plays.length > 0 && (
            <section aria-label="Words played" className="pt-6">
              <h2 className="px-1 pb-2 font-display text-heading">Words played</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-lg bg-muted/50">
                {plays.map(({ m, i }) => (
                  <PlayedWords key={i} words={m.words!} by={match.players[m.seat]} isMe={match.players[m.seat]?.userId === meId} score={m.score} />
                ))}
              </ul>
            </section>
          )}

          <div className="pt-6">
            <Rules rules={scrabbleRules(match.mode as ModeKey, settingsOf(match.mode, match.settings))} defaultOpen={false} />
          </div>

          {playing && (
            <div className="mt-auto pt-8">
              <ResignButton
                match={match}
                className="h-14 w-full rounded-lg"
                detail={match.players.length > 2 ? "Your tiles go back in the bag and the others play on. You place last." : "The other player wins and gets the rating points."}
              />
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function PlayerRow({ player, seat, state, isMe, planning }: { player: MatchView["players"][number]; seat: number; state: ScrabbleState; isMe: boolean; planning: number }) {
  const { online } = useHere(player.userId);
  const up = state.turn === seat;
  const out = state.out.includes(seat);
  return (
    <li className={cn("flex min-h-14 items-center gap-3 rounded-lg px-3 py-2", up ? "bg-primary/12 ring-2 ring-inset ring-primary" : "bg-muted/50", out && "opacity-50")} aria-current={up ? "true" : undefined}>
      <span className="relative shrink-0">
        <PlayerAvatar name={player.name} image={player.image} frame={player.frame} frameColor={player.frameColor} size={36} />
        <span className="absolute -bottom-0.5 -right-0.5 [--dot-ring:var(--card)]">
          <OnlineDot online={online} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-semibold">
          <span className="size-2 shrink-0 rounded-full" style={{ background: SEAT_COLORS[player.color ?? ""] }} />
          <span className="truncate">{isMe ? "You" : player.name}</span>
        </span>
        <span className="flex items-center gap-1 text-footnote text-muted-foreground">
          {out ? "Resigned" : up ? (isMe ? "Your turn" : "Their turn") : `${state.racks[seat]} tiles`}
          {planning > 0 && !isMe && (
            <span className="flex items-center gap-0.5" aria-label={`Planning ${planning} tiles`}>
              · <PencilSimpleIcon weight="fill" size={12} /> {planning}
            </span>
          )}
        </span>
      </span>
      <span className="font-display text-heading tabular-nums" aria-label={`${state.scores[seat]} points`}>
        {state.scores[seat]}
      </span>
    </li>
  );
}

// One turn's words. Tap a word for what it means (from the free dictionary at dictionaryapi.dev).
function PlayedWords({ words, by, isMe, score }: { words: { word: string; score: number }[]; by: MatchView["players"][number] | undefined; isMe: boolean; score: number }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ background: SEAT_COLORS[by?.color ?? ""] }} />
        <span className="min-w-0 flex-1 truncate text-footnote text-muted-foreground">{isMe ? "You" : by?.name}</span>
        <span className="text-footnote font-semibold tabular-nums">+{score}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {words.map((w) => (
          <button
            key={w.word}
            type="button"
            onClick={() => setOpen((o) => (o === w.word ? null : w.word))}
            aria-expanded={open === w.word}
            className={cn("min-h-9 rounded-md px-2.5 font-display text-callout tracking-wide transition-colors", open === w.word ? "bg-primary text-primary-foreground" : "bg-card")}
          >
            {w.word}
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>{open && <Definition key={open} word={open} />}</AnimatePresence>
    </li>
  );
}

const definitions = new Map<string, Promise<{ part: string; text: string } | null>>();
function define(word: string) {
  if (!definitions.has(word)) {
    definitions.set(
      word,
      fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const m = d?.[0]?.meanings?.[0];
          return m ? { part: m.partOfSpeech as string, text: m.definitions?.[0]?.definition as string } : null;
        })
        .catch(() => null),
    );
  }
  return definitions.get(word)!;
}

function Definition({ word }: { word: string }) {
  const [def, setDef] = useState<{ part: string; text: string } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void define(word).then((d) => live && setDef(d));
    return () => {
      live = false;
    };
  }, [word]);
  return (
    <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden text-footnote">
      <span className="block pt-2">
        {def === undefined ? "Looking it up…" : def ? (
          <>
            <span className="italic text-muted-foreground">{def.part}. </span>
            {def.text}
          </>
        ) : (
          "No definition found, but it's in the word list."
        )}
      </span>
    </motion.p>
  );
}

// The bag: how many tiles are left, and which letters are still out there (in the bag or in other racks).
export function BagSheet({ open, onOpenChange, match, state, rack }: { open: boolean; onOpenChange: (o: boolean) => void; match: MatchView; state: ScrabbleState; rack: Tile[] | undefined }) {
  const all = bagLetters(settingsOf(match.mode, match.settings).bag);
  const unseen = new Map<string, number>();
  for (const l of all) unseen.set(l, (unseen.get(l) ?? 0) + 1);
  for (const t of state.tiles) {
    const k = t.blank ? "?" : t.letter;
    unseen.set(k, Math.max(0, (unseen.get(k) ?? 0) - 1));
  }
  for (const t of rack ?? []) unseen.set(t.letter, Math.max(0, (unseen.get(t.letter) ?? 0) - 1));
  const letters = [...unseen.keys()].sort((a, b) => (a === "?" ? 1 : b === "?" ? -1 : a.localeCompare(b)));
  const total = [...unseen.values()].reduce((a, b) => a + b, 0);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>{state.bag} in the bag</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <p className="pb-3 text-center text-footnote text-muted-foreground">{total} letters you haven't seen, in the bag or in other racks</p>
          <ul className="grid grid-cols-6 gap-2" aria-label="Unseen letters">
            {letters.map((l) => {
              const n = unseen.get(l)!;
              return (
                <li key={l} className={cn("flex flex-col items-center gap-0.5", n === 0 && "opacity-30")} aria-label={`${l === "?" ? "Blank" : l}: ${n}`}>
                  <LetterTile letter={l} size={40} />
                  <span className="text-footnote font-semibold tabular-nums">×{n}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// The buttons under your rack: the bag on the left, Swap, Play, and Shuffle (or Recall) on the right.
// Swapping with nothing picked passes the turn instead.
export function DockActions({
  match,
  myTurn,
  placed,
  evaluation,
  bad,
  checking,
  swapping,
  setSwapping,
  bagCount,
  onBag,
  onShuffle,
  onRecall,
  onPlay,
}: {
  match: MatchView;
  myTurn: boolean;
  placed: Placement[];
  evaluation: ReturnType<typeof evaluate> | null;
  bad: string[];
  checking: boolean;
  swapping: number[] | null;
  setSwapping: (s: number[] | null) => void;
  bagCount: number;
  onBag: () => void;
  onShuffle: () => void;
  onRecall: () => void;
  onPlay: () => Promise<void>;
}) {
  const swap = useMutation(api.scrabble.swap);
  const pass = useMutation(api.scrabble.pass);
  const small = "h-14 w-14 shrink-0 flex-col gap-0.5 rounded-lg px-0 text-caption [&_svg:not([class*='size-'])]:size-[22px]";
  const bag = (
    <Button variant="secondary" className={cn(small, "relative")} onClick={onBag} aria-label={`Bag, ${bagCount} left`}>
      <ToteSimpleIcon weight="fill" />
      <span className="font-display tabular-nums">{bagCount}</span>
    </Button>
  );

  if (swapping) {
    const passing = swapping.length === 0;
    return (
      <div className="flex gap-2">
        <Button size="xl" variant="secondary" onClick={() => setSwapping(null)}>
          Cancel
        </Button>
        <AsyncButton
          size="xl"
          className="flex-1"
          variant={passing ? "secondary" : "default"}
          disabled={swapping.length > bagCount}
          icon={passing ? <SkipForwardIcon weight="bold" /> : <ArrowsClockwiseIcon weight="bold" />}
          onClick={async () => {
            if (passing) await pass({ id: match._id });
            else await swap({ id: match._id, tileIds: swapping });
            setSwapping(null);
          }}
        >
          {passing ? "Pass turn" : swapping.length > bagCount ? `Only ${bagCount} in the bag` : `Swap ${swapping.length}`}
        </AsyncButton>
      </div>
    );
  }

  const label =
    !evaluation ? (myTurn ? "Play" : "Your turn's next")
    : !evaluation.ok ? evaluation.error
    : bad.length ? (bad.length === 1 ? `${bad[0]} isn't a word` : `${bad.length} aren't words`)
    : checking ? `${evaluation.score} points`
    : myTurn ? `Play ${evaluation.words[0].word} for ${evaluation.score}`
    : `Planned: ${evaluation.words[0].word}, ${evaluation.score}`;
  const canPlay = myTurn && !!evaluation?.ok && bad.length === 0 && !checking;

  return (
    <div className="flex items-stretch gap-2">
      {bag}
      <Button variant="secondary" className={small} disabled={!myTurn} onClick={() => setSwapping([])} aria-label="Swap or pass">
        <ArrowsClockwiseIcon weight="bold" />
        Swap
      </Button>
      <AsyncButton size="xl" className="min-w-0 flex-1 px-3" disabled={!canPlay} icon={myTurn ? <HandIcon weight="fill" /> : undefined} onClick={onPlay}>
        <span className="truncate">{label}</span>
      </AsyncButton>
      {placed.length > 0 ? (
        <Button variant="secondary" className={small} onClick={onRecall} aria-label="Recall tiles">
          <ArrowCounterClockwiseIcon weight="bold" />
          Recall
        </Button>
      ) : (
        <Button variant="secondary" className={small} onClick={onShuffle} aria-label="Shuffle tiles">
          <ShuffleIcon weight="bold" />
          Shuffle
        </Button>
      )}
    </div>
  );
}
