import { useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { QuoteView } from "../../../convex/stonks";
import type { Point } from "../../../convex/stonks/board";
import { display, INDEX, marketOf, RANGES, type Market, type Range } from "../../../convex/stonks/market";
import type { ProfileStats } from "../../../convex/stonks/profile";
import { Segmented } from "@/components/Segmented";
import { useNow } from "@/lib/time";
import { Change } from "./bits";
import { movingAverage, PriceChart, type Dir } from "./Chart";
import { opensAt, periodName, pointTime, price, sessionName, soon, unitOf } from "./format";
import { usePro } from "./pro";
import { S } from "./skeletons";
import { Ticker } from "./Ticker";
import { savedRange } from "./warm";

export const HOUR = 3600_000;
export const dayDomain = (open: number, close: number): [number, number] => [open - 5.5 * HOUR, close + 4 * HOUR];
// The 1D axis runs 4am to 8pm for anything that trades then; the index (and anything with no extended
// hours yet) gets just the session, so its line fills the chart.
export function axisFor(open: number, close: number, points: Point[], q?: { time: number } | null): [number, number] {
  const [from, to] = dayDomain(open, close);
  // The closing auction prints a few minutes after the bell; that's still the session.
  const late = close + 5 * 60_000;
  const outside = (t: number) => t >= from && t <= to && (t < open - 60_000 || t >= late);
  const extended = points.some((p) => outside(p[0])) || (!!q && outside(q.time));
  return extended ? [from, to] : [open, close];
}

/** An earnings report this week (or earlier today): what's about to move the price. */
export const earningsSoon = (t: number | undefined, now: number) => !!t && t > now - 12 * HOUR && t - now < 6 * 86_400_000;

// The range sticks, on this phone, across stocks and visits.
function useRange(): [Range, (r: Range) => void] {
  const [range, setRange] = useState<Range>(savedRange);
  return [range, (r) => (localStorage.setItem("stonks-range", r), setRange(r))];
}

// While a new range loads, the old chart stays up, faded, instead of flashing empty.
function useHeld<T>(value: T | undefined) {
  const ref = useRef(value);
  if (value !== undefined) ref.current = value;
  return { value: ref.current, stale: value === undefined };
}

/** History plus the live price on the end, kept to the day on the 1D chart. */
export function withLive(points: Point[], q: { time: number; price: number } | null | undefined, domain?: [number, number]) {
  const pts = domain ? points.filter((p) => p[0] >= domain[0] && p[0] <= domain[1]) : points;
  if (!q || (domain && (q.time < domain[0] || q.time > domain[1]))) return pts;
  const last = pts.at(-1);
  if (last && q.time <= last[0]) return pts;
  return [...pts, [q.time, q.price] as Point];
}

export const dirOf = (p?: number, base?: number): Dir => (p !== undefined && base !== undefined && p < base ? "down" : "up");

// One stock's chart, with its price above it.
export function StockChart({ symbol, quote, title, stats }: { symbol: string; quote: QuoteView | undefined; title?: string; stats?: ProfileStats | null }) {
  const [range, setRange] = useRange();
  const [pro] = usePro();
  const chart = useHeld(useQuery(api.stonks.chart, { symbol, range }));
  const [scrub, setScrub] = useState<Point | null>(null);
  const now = useNow(5_000);
  const unit = unitOf(quote ?? (symbol === INDEX ? { type: "INDEX" } : null));
  const market = marketOf(quote, now);
  // The day's axis: 4am to 8pm in New York, the session elsewhere, and just the points for what never shuts.
  const open = range === "1D" ? market.day?.open : undefined;
  const close = range === "1D" ? market.day?.close : undefined;
  const newYork = market.kind === "newYork";
  const day = useMemo<[number, number] | undefined>(
    () => (open === undefined || close === undefined ? undefined : newYork ? dayDomain(open, close) : [open, close]),
    [open, close, newYork],
  );
  const points = useMemo(() => withLive(chart.value?.points ?? [], quote, day), [chart.value, quote, day]);
  const domain = useMemo(
    () => (open === undefined || close === undefined ? undefined : newYork ? axisFor(open, close, points, quote) : ([open, close] as [number, number])),
    [open, close, newYork, points, quote],
  );
  const regular = useMemo<[number, number] | undefined>(() => (open === undefined || close === undefined || !newYork ? undefined : [open, close]), [open, close, newYork]);
  const period = range === "1D" ? (open === undefined ? "Today" : sessionName(open, now)) : periodName[range];
  const base = range === "1D" ? quote?.prevClose : points[0]?.[1];
  const last = scrub?.[1] ?? quote?.price ?? points.at(-1)?.[1];
  const dir = dirOf(points.at(-1)?.[1], base);
  // After hours (or before the open), the move since the bell is its own line.
  const ext = !scrub && newYork && range === "1D" && quote?.regularPrice !== undefined && quote.session && quote.session !== "regular" ? quote.price - quote.regularPrice : null;
  const isLive = !!quote && now - quote.recv < 2 * 60_000;
  // Pro: the 50- and 200-day moving averages on the year (on five years, 10 and 40 weeks are the same).
  const overlays = useMemo(() => {
    if (!pro || (range !== "1Y" && range !== "5Y")) return undefined;
    const closes = points.map((p) => p[1]);
    const [a, b] = range === "1Y" ? [50, 200] : [10, 40];
    return [
      {
        values: movingAverage(closes, a),
        color: "var(--primary)",
        name: "50-day",
      },
      {
        values: movingAverage(closes, b),
        color: "var(--muted-foreground)",
        name: "200-day",
      },
    ];
  }, [pro, range, points]);

  return (
    <section aria-label={`${title ?? display(symbol)} chart`} className="flex flex-col gap-3">
      <div className="px-1">
        <div className={`flex ${S.heroTop} items-center justify-between gap-3`}>
          <span className="truncate text-callout font-semibold text-muted-foreground">{title ?? quote?.name ?? display(symbol)}</span>
          <MarketState market={market} earnings={stats?.earnings} now={now} />
        </div>
        <div className={`flex ${S.heroPrice} items-center font-display text-title-lg`}>
          {last !== undefined && <Ticker value={last} text={price(last, unit)} instant={!!scrub} />}
        </div>
        <div className={`flex ${S.heroLine} items-center`}>
          {last !== undefined && base ? <Change change={last - base} base={base} unit={unit} label={scrub ? pointTime(scrub[0], range) : period} instant={!!scrub} /> : null}
        </div>
        {symbol !== INDEX && (
          <div className={`flex ${S.heroLine} items-center`}>
            {ext !== null && quote?.regularPrice ? (
              <Change
                change={ext}
                base={quote.regularPrice}
                unit={unit}
                label={quote.session === "pre" ? "Pre-market" : quote.session === "overnight" ? "Overnight" : "After hours"}
              />
            ) : null}
          </div>
        )}
      </div>
      <PriceChart
        points={points}
        baseline={range === "1D" ? quote?.prevClose : undefined}
        domain={domain}
        regular={regular}
        dir={dir}
        live={isLive && range === "1D"}
        label={`${title ?? display(symbol)}, ${period.toLowerCase()}${last !== undefined ? `, ${price(last, unit)}` : ""}`}
        timeLabel={(t) => pointTime(t, range)}
        onScrub={setScrub}
        stale={chart.stale}
        reveal={`${symbol}:${range}`}
        overlays={overlays}
        height={S.chart}
      />
      <Segmented label="Range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: r }))} />
    </section>
  );
}

function MarketState({ market, earnings, now }: { market: Market; earnings?: number; now: number }) {
  const clock = market.clock;
  const text =
    market.kind === "always"
      ? "Open 24/7"
      : clock
        ? clock.state === "open"
          ? "Market open"
          : clock.state === "pre"
            ? "Pre-market"
            : clock.state === "post"
              ? "After hours"
              : `Opens ${opensAt(clock.nextOpen)}`
        : market.open
          ? "Market open"
          : "Market closed";
  // An earnings report this week beats the market's hours: it's what's about to move the price.
  if (!market.late && earningsSoon(earnings, now))
    return <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-footnote font-semibold text-muted-foreground">Earnings {soon(earnings!, now)}</span>;
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-footnote font-medium text-muted-foreground">
      {market.open && <span className="size-2 rounded-full bg-online" />}
      {text}
      {market.open && market.late > 0 && ` · ${market.late} min late`}
    </span>
  );
}
