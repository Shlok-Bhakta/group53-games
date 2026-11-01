import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { QuoteView } from "../../../convex/stonks";
import type { Point } from "../../../convex/stonks/board";
import { display, INDEX, marketClock, RANGES, type Clock, type Range } from "../../../convex/stonks/market";
import { NavBar } from "@/components/AppHeader";
import { Group, Section } from "@/components/parts";
import { Segmented } from "@/components/Segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PriceChart, Sparkline, type Dir } from "./Chart";
import { ago, asOfDay, opensAt, percent, periodName, pointTime, price, sessionName, signed, tradeTime, weight } from "./format";

// Stonks: the S&P 500's twenty biggest companies, ranked by their share of the index, live.
// Prices stream in from the stonks sidecar through convex/stonks.ts; every phone sees each trade the
// moment Convex has it. Pre-market and after hours count: the day's chart runs 4am to 8pm New York.

const HOUR = 3600_000;
const dayDomain = (c: Clock): [number, number] => [c.day.open - 5.5 * HOUR, c.day.close + 4 * HOUR];
// The 1D axis runs 4am to 8pm for anything that trades then; the index (and anything with no extended
// hours yet) gets just the session, so its line fills the chart.
function axisFor(c: Clock, points: Point[], q?: { time: number } | null): [number, number] {
  const [from, to] = dayDomain(c);
  // The closing auction prints a few minutes after the bell; that's still the session.
  const late = c.day.close + 5 * 60_000;
  const outside = (t: number) => t >= from && t <= to && (t < c.day.open - 60_000 || t >= late);
  const extended = points.some((p) => outside(p[0])) || (!!q && outside(q.time));
  return extended ? [from, to] : [c.day.open, c.day.close];
}

function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(i);
  }, [every]);
  return now;
}

// The range sticks, on this phone, across stocks and visits.
function useRange(): [Range, (r: Range) => void] {
  const [range, setRange] = useState<Range>(() => {
    const saved = localStorage.getItem("stonks-range");
    return (RANGES as readonly string[]).includes(saved ?? "") ? (saved as Range) : "1D";
  });
  return [range, (r) => (localStorage.setItem("stonks-range", r), setRange(r))];
}

// While a new range loads, the old chart stays up, faded, instead of flashing empty.
function useHeld<T>(value: T | undefined) {
  const ref = useRef(value);
  if (value !== undefined) ref.current = value;
  return { value: ref.current, stale: value === undefined };
}

/** History plus the live price on the end, kept to the day on the 1D chart. */
function withLive(points: Point[], q: { time: number; price: number } | null | undefined, domain?: [number, number]) {
  const pts = domain ? points.filter((p) => p[0] >= domain[0] && p[0] <= domain[1]) : points;
  if (!q || (domain && (q.time < domain[0] || q.time > domain[1]))) return pts;
  const last = pts.at(-1);
  if (last && q.time <= last[0]) return pts;
  return [...pts, [q.time, q.price] as Point];
}

const live = (q: { recv: number } | null | undefined, clock: Clock, now: number) => !!q && clock.state !== "closed" && now - q.recv < 2 * 60_000;

// ---- The board ----

export function StonksBoard() {
  const board = useQuery(api.stonks.board);
  const sparks = useQuery(api.stonks.sparks);
  const now = useNow(15_000);
  const clock = marketClock(now);

  return (
    <div className="flex flex-col gap-6">
      <NavBar title="Stonks" back="/games" />
      <StockChart symbol={INDEX} quote={board?.index ?? undefined} clock={clock} title="S&P 500" />
      {board === undefined ? (
        <Group>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="p-4">
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </Group>
      ) : board.rows.length === 0 ? (
        <p className="px-1 text-callout text-muted-foreground">Waiting for prices</p>
      ) : (
        <Section title={`Top ${board.rows.length}`}>
          {board.rows.map((r) => (
            <motion.div key={r.symbol} layout="position" transition={{ type: "spring", bounce: 0, duration: 0.5 }}>
              <Link
                to={`/stonks/${encodeURIComponent(r.symbol)}`}
                className="flex min-h-16 items-center gap-3 px-4 py-2.5 transition-transform active:scale-[0.97]"
                aria-label={`${display(r.symbol)}, ${r.name}`}
              >
                <span className="w-5 shrink-0 text-right text-footnote font-semibold text-muted-foreground tabular-nums">{r.rank}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-body">{display(r.symbol)}</span>
                  <span className="block truncate text-footnote text-muted-foreground">
                    {weight(r.weight)} · {r.name}
                  </span>
                </span>
                <Spark points={sparks?.[r.symbol] ?? []} quote={r} clock={clock} />
                <span className="flex w-[92px] shrink-0 flex-col items-end gap-1">
                  <Flash value={r.price} className="text-callout font-semibold tabular-nums">
                    {price(r.price)}
                  </Flash>
                  {r.prevClose ? <Change change={r.price - r.prevClose} base={r.prevClose} small /> : null}
                </span>
              </Link>
            </motion.div>
          ))}
        </Section>
      )}
      {board && <Sources board={board} now={now} />}
    </div>
  );
}

function Spark({ points, quote, clock }: { points: Point[]; quote: QuoteView; clock: Clock }) {
  const day = dayDomain(clock);
  const domain = axisFor(clock, points, quote);
  return <Sparkline points={withLive(points, quote, day)} baseline={quote.prevClose} domain={domain} dir={dirOf(quote.price, quote.prevClose)} />;
}

const dirOf = (p?: number, base?: number): Dir => (p !== undefined && base !== undefined && p < base ? "down" : "up");

type Board = FunctionReturnType<typeof api.stonks.board>;
function Sources({ board, now }: { board: Board; now: number }) {
  const down = board.feeds.filter((f) => f.state === "down");
  const using = [...new Set(board.rows.map((r) => r.source).filter((s): s is string => !!s && s !== "history").map(sourceName))];
  const parts = [using.length > 0 && `Prices from ${using.join(" and ")}`, board.asOf && `weights from SPY, ${asOfDay(board.asOf)}`, ...down.map((f) => `${sourceName(f.source)} down ${ago(now - f.at)}`)];
  return <p className="px-1 text-footnote text-muted-foreground">{parts.filter(Boolean).join(" · ")}</p>;
}
const sourceName = (s: string) => ({ yahoo: "Yahoo", nasdaq: "Nasdaq", history: "Yahoo" })[s] ?? s;

// A price that just changed lights up for a moment, green if it went up and red if it went down.
function Flash({ value, className, children }: { value: number; className?: string; children: React.ReactNode }) {
  const prev = useRef(value);
  const [hit, setHit] = useState<{ dir: Dir; n: number } | null>(null);
  useEffect(() => {
    if (value !== prev.current) setHit((h) => ({ dir: value > prev.current ? "up" : "down", n: (h?.n ?? 0) + 1 }));
    prev.current = value;
  }, [value]);
  return (
    <span className={cn("relative -mx-1 rounded-sm px-1", className)}>
      <AnimatePresence>
        {hit && (
          <motion.span
            key={hit.n}
            aria-hidden
            className="absolute inset-0 rounded-sm"
            style={{ background: `color-mix(in oklch, var(--${hit.dir}) 28%, transparent)` }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      <span className="relative">{children}</span>
    </span>
  );
}

// "▲ +1.23 (0.45%)": the caret carries the color; the numbers stay in text color, with a sign, so up and
// down never depend on telling green from red.
function Change({ change, base, symbol, small, label }: { change: number; base: number; symbol?: string; small?: boolean; label?: string }) {
  const dir: Dir = change < 0 ? "down" : "up";
  const Icon = dir === "up" ? CaretUpIcon : CaretDownIcon;
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", small ? "text-footnote" : "text-callout")}>
      <Icon weight="fill" className="shrink-0" style={{ color: `var(--${dir})` }} aria-label={dir === "up" ? "up" : "down"} />
      {small ? `${change < 0 ? "−" : "+"}${percent((change / base) * 100)}` : `${signed(change, symbol)} (${percent((change / base) * 100)})`}
      {label && <span className="font-medium text-muted-foreground">{label}</span>}
    </span>
  );
}

// ---- One stock's chart, with its price above it ----

function StockChart({ symbol, quote, clock, title }: { symbol: string; quote: QuoteView | undefined; clock: Clock; title?: string }) {
  const [range, setRange] = useRange();
  const chart = useHeld(useQuery(api.stonks.chart, { symbol, range }));
  const [scrub, setScrub] = useState<Point | null>(null);
  const now = useNow(5_000);
  const day = range === "1D" ? dayDomain(clock) : undefined;
  const points = useMemo(() => withLive(chart.value?.points ?? [], quote, day), [chart.value, quote, day?.[0], day?.[1]]);
  const domain = range === "1D" ? axisFor(clock, points, quote) : undefined;
  const period = range === "1D" ? sessionName(clock.day.open, now) : periodName[range];
  const base = range === "1D" ? quote?.prevClose : points[0]?.[1];
  const last = scrub?.[1] ?? quote?.price ?? points.at(-1)?.[1];
  const dir = dirOf(points.at(-1)?.[1], base);
  // After hours (or before the open), the move since the bell is its own line.
  const ext = !scrub && range === "1D" && quote?.regularPrice !== undefined && quote.session && quote.session !== "regular" && symbol !== INDEX ? quote.price - quote.regularPrice : null;
  const isLive = live(quote, clock, now);

  return (
    <section aria-label={`${title ?? display(symbol)} chart`} className="flex flex-col gap-3">
      <div className="px-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-callout font-semibold text-muted-foreground">{title ?? quote?.name ?? display(symbol)}</span>
          <MarketState clock={clock} />
        </div>
        {last !== undefined ? (
          <div className="font-display text-title-lg" aria-live="off">
            {price(last, symbol)}
          </div>
        ) : (
          <Skeleton className="my-1 h-10 w-44" />
        )}
        <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
          {last !== undefined && base ? <Change change={last - base} base={base} symbol={symbol} label={scrub ? pointTime(scrub[0], range) : period} /> : null}
          {ext !== null && quote?.regularPrice ? <Change change={ext} base={quote.regularPrice} symbol={symbol} label={quote.session === "pre" ? "Pre-market" : "After hours"} /> : null}
        </div>
      </div>
      <PriceChart
        points={points}
        baseline={range === "1D" ? quote?.prevClose : undefined}
        domain={domain}
        regular={range === "1D" ? [clock.day.open, clock.day.close] : undefined}
        dir={dir}
        live={isLive && range === "1D"}
        label={`${title ?? display(symbol)}, ${period.toLowerCase()}${last !== undefined ? `, ${price(last, symbol)}` : ""}`}
        timeLabel={(t) => pointTime(t, range)}
        onScrub={setScrub}
        stale={chart.stale}
      />
      <Segmented label="Range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: r }))} />
    </section>
  );
}

function MarketState({ clock }: { clock: Clock }) {
  const text = clock.state === "open" ? "Market open" : clock.state === "pre" ? "Pre-market" : clock.state === "post" ? "After hours" : `Opens ${opensAt(clock.nextOpen)}`;
  return (
    <span className="flex items-center gap-1.5 text-footnote font-medium text-muted-foreground">
      {clock.state === "open" && <span className="size-2 rounded-full bg-online" />}
      {text}
    </span>
  );
}

// ---- One stock ----

export function StockPage() {
  const { symbol = "" } = useParams();
  const quote = useQuery(api.stonks.quote, { symbol });
  const board = useQuery(api.stonks.board);
  const now = useNow(5_000);
  const clock = marketClock(now);
  const rank = board?.rows.find((r) => r.symbol === symbol)?.rank;

  return (
    <div className="flex flex-col gap-6">
      <NavBar title={display(symbol)} subtitle={quote?.name} back="/stonks" />
      <StockChart symbol={symbol} quote={quote ?? undefined} clock={clock} title={quote?.name ?? display(symbol)} />
      {quote && (
        <Section title="Stats">
          {quote.weight !== undefined && <Stat label="Share of the S&P 500" value={`${weight(quote.weight)}${rank ? ` · #${rank}` : ""}`} />}
          {quote.prevClose !== undefined && <Stat label="Previous close" value={price(quote.prevClose, symbol)} />}
          {quote.dayLow !== undefined && quote.dayHigh !== undefined && <Stat label="Today's range" value={`${price(quote.dayLow, symbol)} – ${price(quote.dayHigh, symbol)}`} />}
          <Stat label="Last trade" value={`${tradeTime(quote.time, now)} · ${sourceName(quote.source)}`} />
        </Section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-3">
      <span className="text-callout text-muted-foreground">{label}</span>
      <span className="text-callout font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default StonksBoard;
