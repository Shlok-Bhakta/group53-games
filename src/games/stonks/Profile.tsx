import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { motion } from "motion/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Point } from "../../../convex/stonks/board";
import { display } from "../../../convex/stonks/market";
import { NavBar } from "@/components/AppHeader";
import { Section } from "@/components/parts";
import { PlayerCard } from "@/components/PlayerCard";
import { cardColor, Change, gainColor, Pairs, playerColors, useHereNow } from "./bits";
import { PriceChart } from "./Chart";
import { ago, price } from "./format";
import { PlayerSkeleton, S } from "./skeletons";
import { Ticker } from "./Ticker";
import { PositionRow, Waiting, worthLine, type Portfolio } from "./Trade";
import { warmBoard, warmStock } from "./warm";

// A player's stock profile: their card, with all its frames and effects, then how they're doing, what they hold, what
// they're waiting on and everything they've done. Tap anything they hold and you're on its page, with Buy at your thumb.

type Profile = NonNullable<FunctionReturnType<typeof api.stonks.player>>;
const DID: Record<string, string> = { buy: "Bought", sell: "Sold", short: "Shorted", cover: "Covered" };
const whenFull = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function PlayerPage() {
  const { id = "" } = useParams();
  const convex = useConvex();
  const userId = id as Id<"users">;
  const p = useQuery(api.stonks.player, { userId });
  const crew = useQuery(api.stonks.crew);
  const history = useQuery(api.stonks.worthHistory);
  const [now, setNow] = useState(() => Date.now());
  const [scrub, setScrub] = useState<Point | null>(null);
  useHereNow();
  useEffect(() => {
    warmBoard(convex);
    const i = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(i);
  }, [convex]);
  const color = useMemo(() => (crew ? playerColors(crew).get(id)?.color : undefined), [crew, id]);
  const worth = p?.worth;
  const line = useMemo(() => (history && worth !== undefined ? worthLine(history, id, { t: Math.max(now, (history.at(-1)?.t ?? 0) + 1), worth }) : []), [history, id, now, worth]);
  const domain = useMemo<[number, number] | undefined>(() => (line.length > 1 ? [line[0][0], line[line.length - 1][0]] : undefined), [line]);
  if (p === undefined || history === undefined) return <PlayerSkeleton />;
  if (p === null)
    return (
      <div className="flex flex-col gap-6">
        <NavBar title="Stonks" back="/stonks" />
        <p className="px-1 text-callout text-muted-foreground">Nobody here</p>
      </div>
    );
  const shown = scrub?.[1] ?? p.worth;
  const tint = cardColor(p.card.frame, p.card.frameColor);
  return (
    <div className="flex flex-col gap-6">
      <NavBar title={p.me ? "You" : p.card.name} subtitle={`#${p.place} of ${p.of}`} back="/stonks" />
      <section aria-label={`${p.card.name}'s money`} className="relative flex gap-4">
        {/* Their card's color spills out behind it. */}
        {tint && <div aria-hidden className="pointer-events-none absolute -top-8 -bottom-8 -left-24 -z-10 w-[320px]" style={{ background: `radial-gradient(closest-side, color-mix(in oklch, ${tint} 28%, transparent), transparent)` }} />}
        <PlayerCard player={p.card} className="w-[132px] shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <span className="text-callout font-semibold text-muted-foreground">Net worth</span>
          <span className="font-display text-title">
            <Ticker value={shown} text={price(shown)} instant={!!scrub} />
          </span>
          <Change change={shown - p.start} base={p.start} label={scrub ? whenFull.format(scrub[0]) : "All time"} instant={!!scrub} />
        </div>
      </section>
      {line.length > 1 && (
        <div className="relative">
          <PriceChart
            points={line}
            baseline={p.start}
            domain={domain}
            dir={p.gain < 0 ? "down" : "up"}
            color={color}
            glow={p.card.glow}
            label={`${p.card.name}'s net worth over the game, now ${price(p.worth)}`}
            timeLabel={(t) => whenFull.format(t)}
            onScrub={setScrub}
            reveal={id}
            height={S.chart}
          />
          {/* Foil or a CRT on their card goes on their chart too. */}
          {p.card.effect !== "none" && <div className="pcard-fx chart-fx" data-effect={p.card.effect} />}
        </div>
      )}
      <GainPie p={p} />
      {p.positions.length > 0 && (
        <Section title={p.me ? "Your positions" : "Positions"}>
          {p.positions.map((x) => (
            <PositionRow key={x.symbol} p={x} owner={p.me ? undefined : p.card.name} swatch={gainColor(x.gainPct)} />
          ))}
        </Section>
      )}
      <Waiting orders={p.waiting as Portfolio["waiting"]} now={now} readOnly={!p.me} />
      {p.record.trades > 0 && (
        <section aria-label="Record">
          <div className="flex items-end justify-between px-1 pb-2.5">
            <h2 className="font-display text-heading">Record</h2>
          </div>
          <Pairs
            items={[
              ["Trades", String(p.record.trades)],
              ["Closed", p.record.wins + p.record.losses ? `${p.record.wins} won, ${p.record.losses} lost` : undefined],
              ["Banked", p.record.wins + p.record.losses ? `${p.record.realized < 0 ? "−" : "+"}${price(Math.abs(p.record.realized))}` : undefined],
              ["Idle", price(p.idle)],
              ["Best", p.record.best ? `${display(p.record.best.symbol)} ${p.record.best.realized < 0 ? "−" : "+"}${price(Math.abs(p.record.best.realized))}` : undefined],
              ["Worst", p.record.worst ? `${display(p.record.worst.symbol)} ${p.record.worst.realized < 0 ? "−" : "+"}${price(Math.abs(p.record.worst.realized))}` : undefined],
            ]}
          />
        </section>
      )}
      {p.history.length > 0 && (
        <Section title="History">
          {p.history.map((h) => (
            <Link
              key={h.id}
              to={`/stonks/${encodeURIComponent(h.symbol)}`}
              onPointerDown={() => warmStock(convex, h.symbol, "open")}
              className={`flex ${S.crew} items-center justify-between gap-3 px-4 transition-transform duration-100 active:scale-[0.97]`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-callout font-semibold">
                  {DID[h.side]} {display(h.symbol)}
                </span>
                <span className="block truncate text-footnote text-muted-foreground">
                  {price(h.amount)} at {price(h.price, h.currency)} · {ago(now - h.at)}
                </span>
              </span>
              {h.realized ? <span className="shrink-0 text-footnote font-semibold tabular-nums">{`${h.realized < 0 ? "−" : "+"}${price(Math.abs(h.realized))}`}</span> : null}
            </Link>
          ))}
        </Section>
      )}
    </div>
  );
}

// Where their money is: a slice per position by size, and what isn't invested. Green's up and red's down, and the
// darker the shade the bigger the move. The list underneath is the rest of the key: each row carries its slice's color.
function GainPie({ p }: { p: Profile }) {
  const [active, setActive] = useState<string | null>(null);
  const SIZE = 220, R = 100, HOLE = 66, GAP = 2 / R; // a 2px gap between slices, in radians at the rim
  const parts = useMemo(() => {
    const rows = p.positions.map((x) => ({ key: x.symbol, label: display(x.symbol), value: Math.abs(x.value), color: gainColor(x.gainPct), pct: x.gainPct as number | null }));
    if (p.idle > 0.005) rows.push({ key: "idle", label: "Idle", value: p.idle, color: "var(--muted)", pct: null });
    const total = rows.reduce((n, r) => n + r.value, 0) || 1;
    let at = -Math.PI / 2;
    return rows.map((r) => {
      const sweep = (r.value / total) * Math.PI * 2;
      const start = at;
      at += sweep;
      return { ...r, share: r.value / total, start, end: at };
    });
  }, [p.positions, p.idle]);
  if (p.positions.length === 0) return null;
  const up = p.positions.filter((x) => x.gain > 0);
  const down = p.positions.filter((x) => x.gain < 0);
  const invested = p.positions.reduce((n, x) => n + Math.abs(x.value), 0) || 1;
  const upShare = up.reduce((n, x) => n + Math.abs(x.value), 0) / invested;
  const chosen = parts.find((x) => x.key === active);
  const arc = (a0: number, a1: number) => {
    // A single slice is the whole ring: two halves, since an arc can't close on itself.
    const whole = a1 - a0 >= Math.PI * 2 - 0.001;
    const s = whole ? a0 : a0 + GAP / 2;
    const e = whole ? a0 + Math.PI * 2 - 0.001 : Math.max(a0 + GAP / 2, a1 - GAP / 2);
    const large = e - s > Math.PI ? 1 : 0;
    const c = SIZE / 2;
    const pt = (r: number, a: number) => `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
    return `M${pt(R, s)}A${R},${R} 0 ${large} 1 ${pt(R, e)}L${pt(HOLE, e)}A${HOLE},${HOLE} 0 ${large} 0 ${pt(HOLE, s)}Z`;
  };
  return (
    <section aria-label="Where the money is" className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} role="img" aria-label={`${up.length} up, ${down.length} down. ${parts.map((x) => `${x.label} ${Math.round(x.share * 100)}%`).join(", ")}`}>
          {parts.map((x, i) => (
            <motion.path
              key={x.key}
              d={arc(x.start, x.end)}
              fill={x.color}
              stroke={active === x.key ? "var(--foreground)" : "none"}
              strokeWidth={active === x.key ? 2 : 0}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: active && active !== x.key ? 0.45 : 1, scale: 1 }}
              transition={{ type: "spring", bounce: 0, duration: 0.45, delay: i * 0.03 }}
              style={{ transformOrigin: "50% 50%", cursor: "pointer" }}
              onClick={() => setActive((k) => (k === x.key ? null : x.key))}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {chosen ? (
            <>
              <span className="max-w-[110px] truncate font-display text-body">{chosen.label}</span>
              <span className="text-callout font-semibold tabular-nums">{Math.round(chosen.share * 100)}%</span>
              {chosen.pct !== null && <span className="text-footnote text-muted-foreground tabular-nums">{`${chosen.pct < 0 ? "−" : "+"}${(Math.abs(chosen.pct) * 100).toFixed(2)}%`}</span>}
            </>
          ) : (
            <>
              <span className="font-display text-title">{Math.round(upShare * 100)}%</span>
              <span className="text-footnote text-muted-foreground">in the green</span>
              <span className="text-footnote text-muted-foreground">
                {up.length} up · {down.length} down
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 text-caption font-medium text-muted-foreground" aria-hidden>
        <span>−10%</span>
        <span className="flex overflow-hidden rounded-full">
          {[-0.2, -0.07, -0.03, -0.01, 0, 0.01, 0.03, 0.07, 0.2].map((x) => (
            <span key={x} className="h-2 w-4" style={{ background: gainColor(x) }} />
          ))}
        </span>
        <span>+10%</span>
        {p.idle > 0.005 && (
          <>
            <span className="ml-2 size-2 rounded-full" style={{ background: "var(--muted)" }} />
            <span>Idle</span>
          </>
        )}
      </div>
    </section>
  );
}

