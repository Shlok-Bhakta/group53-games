import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { cn } from "@/lib/utils";
import { listNames, ordinal, reasonText } from "@/lib/text";
import { Tiles, type TileState } from "@/Tiles";
import { SEAT_COLORS } from "@/games/seats";
import { pointsOf, pointsUnit } from "@/games/summary";
import { Rematch } from "./Rematch";

// The result, spelled in tiles: WON in green, LOST with a crooked red hit tile, DRAW in yellow, and places
// for four players.
function resultTiles(match: MatchView, meId: Id<"users"> | undefined): { word: string; states: TileState[] } | null {
  const r = match.result!;
  if (!meId || !match.players.some((p) => p.userId === meId)) return null;
  if (r.standings && match.players.length > 2) {
    const place = r.standings.findIndex((g) => g.includes(meId));
    if (place === 0) return { word: r.standings[0].length > 1 ? "TIE" : "1ST", states: ["green", "green", "green"] };
    const word = ordinal(place + 1).toUpperCase();
    return { word, states: place === 1 ? ["yellow", "yellow", "yellow"] : ["gray", "gray", "hit"] };
  }
  if (r.draw) return { word: "DRAW", states: ["yellow", "yellow", "yellow", "yellow"] };
  return r.winners.includes(meId) ? { word: "WON", states: ["green", "green", "green"] } : { word: "LOST", states: ["gray", "gray", "gray", "hit"] };
}

export function Result({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const r = match.result!;
  const iPlayed = match.players.some((p) => p.userId === meId);
  const four = match.players.length > 2;
  // Games that keep score list everyone's final points, even with two players.
  const scored = match.players.some((p) => pointsOf(match, p.userId) !== null);
  const change = match.ratingChanges?.find((c) => c.userId === meId);
  const nameOf = (id: Id<"users">) => match.players.find((p) => p.userId === id)?.name ?? "?";
  let title: string;
  if (four && r.standings) {
    const place = meId ? r.standings.findIndex((g) => g.includes(meId)) : -1;
    title = place === 0 ? (r.standings[0].length > 1 ? "Shared first" : "You won") : place > 0 ? `You placed ${ordinal(place + 1)}` : `${listNames(r.standings[0].map(nameOf))} won`;
  } else {
    const won = !r.draw && meId && r.winners.includes(meId);
    title = r.draw ? "Draw" : !iPlayed ? `${match.players.find((p) => r.winners.includes(p.userId))?.name} won` : won ? "You won" : "You lost";
  }
  const tiles = resultTiles(match, meId);
  return (
    <section aria-label="Result" className="flex flex-col items-center text-center">
      {tiles ? (
        <>
          <Tiles word={tiles.word} states={tiles.states} size="xl" flip label={title} />
          <h2 className="sr-only">{title}</h2>
        </>
      ) : (
        <h2 className="font-display text-title">{title}</h2>
      )}
      <p className="mt-3 text-callout text-muted-foreground">{reasonText(r.reason, match.mode)}</p>
      {change && <RatingChange before={change.before} after={change.after} />}
      {(four || scored) && r.standings && <Standings match={match} standings={r.standings} meId={meId} />}
      {iPlayed && meId && <Rematch match={match} meId={meId} />}
    </section>
  );
}

// The new rating counts up (or down) from the old one.
function RatingChange({ before, after }: { before: number; after: number }) {
  const value = useMotionValue(before);
  const shown = useTransform(value, (v) => Math.round(v));
  useEffect(() => {
    const controls = animate(value, after, { duration: 1.1, delay: 0.5, ease: [0.23, 1, 0.32, 1] });
    return () => controls.stop();
  }, [value, after]);
  const delta = after - before;
  return (
    <p className="mt-3 flex items-center gap-2.5">
      <motion.span className="font-display text-title tabular-nums">{shown}</motion.span>
      <span className={cn("rounded-full px-2.5 py-1 text-footnote font-bold tabular-nums", delta >= 0 ? "bg-[var(--tile-green)] text-[var(--tile-ink)]" : "bg-destructive/15 text-destructive")}>
        {delta >= 0 ? "+" : ""}
        {delta}
      </span>
      <span className="sr-only">{`${after} (${delta >= 0 ? "+" : ""}${delta})`}</span>
    </p>
  );
}

function Standings({ match, standings, meId }: { match: MatchView; standings: Id<"users">[][]; meId: Id<"users"> | undefined }) {
  return (
    <ol className="mt-4 w-full divide-y divide-border overflow-hidden rounded-lg bg-card text-left" aria-label="Final standings">
      {standings.flatMap((group, place) =>
        group.map((id) => {
          const p = match.players.find((x) => x.userId === id)!;
          const c = match.ratingChanges?.find((x) => x.userId === id);
          const d = c ? c.after - c.before : 0;
          return (
            <li key={id} className={cn("flex min-h-12 items-center gap-3 px-4 py-2", id === meId && "bg-primary/8")}>
              <span className={cn("w-8 font-display text-body tabular-nums", place === 0 ? "text-[var(--tile-yellow)]" : "text-muted-foreground")}>{ordinal(place + 1)}</span>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: SEAT_COLORS[p.color!] }} />
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              {pointsOf(match, id) !== null && <span className="text-footnote tabular-nums text-muted-foreground">{pointsOf(match, id)} {pointsUnit(match)}</span>}
              {c && <span className={cn("w-10 text-right text-footnote font-semibold tabular-nums", d >= 0 ? "text-[var(--tile-green)]" : "text-destructive")}>{d >= 0 ? "+" : ""}{d}</span>}
            </li>
          );
        }),
      )}
    </ol>
  );
}
