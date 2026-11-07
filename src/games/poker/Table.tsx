import { AnimatePresence, motion } from "motion/react";
import type { MatchView } from "../../../convex/matches";
import { bestHand, madeCards } from "../../../convex/poker/cards";
import { isOut, streetOf } from "../../../convex/poker/engine";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";
import { sum } from "./format";
import { PACE, type Show, type Spell } from "./show";
import { Board, Deck, Pile } from "./table/Felt";
import { MyHand, MyTile, TurnStatus } from "./table/Mine";
import { Roll, SPRING } from "./table/motion";
import { PayChip, Seat } from "./table/Seat";

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
      {show.paying?.map(({ seat }) => Array.from({ length: 5 }, (_, i) => <PayChip key={`${s.hand}:${seat}:${i}`} seat={seat} i={i} color={seatColor(match.players[seat])} />))}

      {me ? (
        <>
          <MyTile match={match} player={me} seat={mySeat} show={show} picking={picking} />
          {!over && <MyHand show={show} seat={mySeat} color={seatColor(me)} cards={cards} picking={picking} swap={swap} onPick={onPick} rung={rung} madeName={show.folded[mySeat] || isOut(s, mySeat) ? null : (made?.name ?? null)} />}
        </>
      ) : (
        <div className="mt-2.5 flex h-11 items-center justify-center">
          <TurnStatus match={match} show={show} />
        </div>
      )}
    </div>
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
