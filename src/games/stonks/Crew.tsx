import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { motion } from "motion/react";
import { api } from "../../../convex/_generated/api";
import type { Point } from "../../../convex/stonks/board";
import { display } from "../../../convex/stonks/market";
import { Group, Section } from "@/components/parts";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Change, Flash, playerColors } from "./bits";
import { CrewChart, valueAt, type Series } from "./Chart";
import { price } from "./format";
import { S } from "./skeletons";
import { Ticker } from "./Ticker";
import { DID, type Crew, type Trades } from "./Trade";
import { playerPath, stockPath, warmPlayer } from "./warm";

export type History = FunctionReturnType<typeof api.stonks.worthHistory>;
const scrubTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** One player's net worth over the game, with where they are right now on the end. */
export function worthLine(history: History, userId: string, now: { t: number; worth: number } | null, start = 10_000): Point[] {
  const points: Point[] = history.map((r) => [r.t, r.worths.find((x) => x.u === userId)?.w ?? start]);
  if (now && (!points.length || now.t > points[points.length - 1][0])) points.push([now.t, now.worth]);
  return points;
}

// The crew's standings, under everyone's net worth over the game. The rows are the chart's key, and while a finger's
// on the chart they show that moment. Tap someone for their profile.
export function CrewBoard({ crew, history }: { crew: Crew; history: History }) {
  const convex = useConvex();
  const [at, setAt] = useState<number | null>(null);
  const colors = useMemo(() => playerColors(crew), [crew]);
  const worths = crew.map((c) => c.worth.toFixed(2)).join();
  const series = useMemo<Series[]>(
    () =>
      history.length === 0
        ? []
        : crew.map((c) => ({ id: c.userId, me: c.me, color: colors.get(c.userId)!.color, dash: colors.get(c.userId)!.dash, points: worthLine(history, c.userId, { t: Math.max(Date.now(), history[history.length - 1].t + 1), worth: c.worth }) })),
    // Rebuilt when someone's worth or the history changes, not on every render.
    [history, worths, colors], // eslint-disable-line
  );
  useEffect(() => {
    for (const c of crew) warmPlayer(convex, c.userId);
  }, [convex, crew]);
  return (
    <Section title="Crew" bare>
      {series.length > 0 && (
        <div className="pb-3">
          <CrewChart series={series} base={10_000} label={`Everyone's net worth over the game. ${crew.map((c) => `${c.name} ${price(c.worth)}`).join(", ")}`} timeLabel={(t) => scrubTime.format(t)} onScrub={setAt} money={(n) => price(n)} />
        </div>
      )}
      <Group>
        {crew.map((c, i) => {
          const line = at !== null ? series.find((s) => s.id === c.userId) : undefined;
          const worth = line ? valueAt(line.points, at!) : c.worth;
          const key = colors.get(c.userId)!;
          return (
            <motion.div key={c.userId} layout="position" transition={{ type: "spring", bounce: 0, duration: 0.5 }}>
              <Link
                to={playerPath(c.userId)}
                onPointerDown={() => warmPlayer(convex, c.userId)}
                aria-label={`${c.name}'s profile`}
                className={cn(`flex ${S.crew} items-center gap-3 px-4 transition-transform duration-100 active:scale-[0.97]`, c.me && "bg-accent/40")}
              >
                <span className="w-4 shrink-0 text-right text-footnote font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                <PlayerAvatar name={c.name} image={c.image} frame={c.frame} frameColor={c.frameColor} glow={c.glow} badge={c.badge} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {series.length > 0 && (
                      <svg width={14} height={4} className="shrink-0" aria-hidden>
                        <line x1={1} x2={13} y1={2} y2={2} stroke={key.color} strokeWidth={3} strokeLinecap="round" strokeDasharray={key.dash ? "3 3" : undefined} />
                      </svg>
                    )}
                    <span className="truncate text-callout font-semibold">{c.name}</span>
                  </span>
                  <span className="block text-footnote text-muted-foreground">{c.positions === 0 ? "All cash" : `${c.positions} ${c.positions === 1 ? "position" : "positions"}`}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <Flash value={worth} className="text-callout font-semibold">
                    <Ticker value={worth} text={price(worth)} instant={at !== null} />
                  </Flash>
                  <Change change={worth - 10_000} base={10_000} small instant={at !== null} />
                </span>
              </Link>
            </motion.div>
          );
        })}
      </Group>
    </Section>
  );
}

export function CrewTrades({ trades, now, title = "Crew trades" }: { trades: Trades; now: number; title?: string }) {
  if (trades.length === 0) return null;
  return (
    <Section title={title}>
      {trades.slice(0, 6).map((t) => (
        <div key={t.id} className={`flex ${S.crew} items-center gap-3 px-4`}>
          <Link to={playerPath(t.userId)} aria-label={`${t.name}'s profile`} className="grid size-11 shrink-0 place-items-center transition-transform duration-100 active:scale-[0.97]">
            <PlayerAvatar name={t.name} image={t.image} size={32} />
          </Link>
          <Link to={stockPath(t.symbol)} className="min-w-0 flex-1 transition-transform duration-100 active:scale-[0.97]">
            <span className="block truncate text-callout font-semibold">
              {t.name} {DID[t.side]} {display(t.symbol)}
            </span>
            <span className="block truncate text-footnote text-muted-foreground">
              {price(t.amount)} at {price(t.price, t.currency)} · {ago(now - t.at, { seconds: true })}
              {t.realized ? ` · ${t.realized > 0 ? "made" : "lost"} ${price(Math.abs(t.realized))}` : ""}
            </span>
          </Link>
        </div>
      ))}
    </Section>
  );
}
