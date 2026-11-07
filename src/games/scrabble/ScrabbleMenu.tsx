import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { settingsOf, type ModeKey } from "../../../convex/modes";
import type { ScrabbleState } from "../../../convex/scrabble/engine";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { GameMenu } from "@/components/GameMenu";
import { ResignButton } from "@/components/match";
import { SeatDot } from "@/components/game/SeatDot";
import { useHere } from "@/presence";
import { seatColor } from "@/games/seats";
import type { Player } from "@/games/types";
import { cn } from "@/lib/utils";
import { scrabbleRules } from "./rules";

// The menu: everyone's score and who's up, the words played (tap one for its meaning), then what every
// game's menu has (settings, how to play, sharing), and resigning, well away from the buttons you tap all game.
export function ScrabbleMenu({
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
    <GameMenu
      open={open}
      onOpenChange={onOpenChange}
      match={match}
      title="Players"
      rules={scrabbleRules(match.mode as ModeKey, settingsOf(match.mode, match.settings))}
      footer={
        playing && (
          <ResignButton
            match={match}
            className="h-14 w-full rounded-lg"
            detail={match.players.length > 2 ? "Your tiles go back in the bag and the others play on. You place last." : "The other player wins and gets the rating points."}
          />
        )
      }
    >
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
    </GameMenu>
  );
}

function PlayerRow({ player, seat, state, isMe, planning }: { player: Player; seat: number; state: ScrabbleState; isMe: boolean; planning: number }) {
  const { online } = useHere(player.userId);
  const up = state.turn === seat;
  const out = state.out.includes(seat);
  return (
    <li className={cn("flex min-h-14 items-center gap-3 rounded-lg px-3 py-2", up ? "bg-primary/12 ring-2 ring-inset ring-primary" : "bg-muted/50", out && "opacity-50")} aria-current={up ? "true" : undefined}>
      <PlayerAvatar player={player} size={36} online={online} dotRing="card" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-semibold">
          <SeatDot color={seatColor(player)} />
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
function PlayedWords({ words, by, isMe, score }: { words: { word: string; score: number }[]; by: Player | undefined; isMe: boolean; score: number }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <SeatDot color={seatColor(by)} />
        <span className="min-w-0 flex-1 truncate text-footnote text-muted-foreground">{isMe ? "You" : by?.name}</span>
        <span className="text-footnote font-semibold tabular-nums">+{score}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {words.map((w) => (
          // 44px to tap, drawn 36px: the extra reaches into the gaps around it without moving anything.
          <button key={w.word} type="button" onClick={() => setOpen((o) => (o === w.word ? null : w.word))} aria-expanded={open === w.word} className="-my-1 touch-manipulation py-1">
            <span className={cn("grid min-h-9 place-items-center rounded-md px-2.5 font-display text-callout tracking-wide transition-colors", open === w.word ? "bg-primary text-primary-foreground" : "bg-card")}>{w.word}</span>
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
