import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { ArrowSquareOutIcon, CalendarBlankIcon, CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { QuoteView } from "../../../convex/stonks";
import type { Point } from "../../../convex/stonks/board";
import { display, INDEX, marketClock, marketOf, RANGES, type Clock, type Market, type Range } from "../../../convex/stonks/market";
import type { NewsItem, ProfileStats } from "../../../convex/stonks/profile";
import { NavBar } from "@/components/AppHeader";
import { Group, Section } from "@/components/parts";
import { Segmented } from "@/components/Segmented";
import { cn } from "@/lib/utils";
import { movingAverage, PriceChart, Sparkline, type Dir } from "./Chart";
import {
  ago,
  asOfDay,
  unitOf,
  big,
  count,
  dayOf,
  frac,
  opensAt,
  percent,
  periodName,
  pointTime,
  price,
  pts,
  RATING,
  ratio,
  sessionName,
  signed,
  soon,
  tradeTime,
  weight,
} from "./format";
import { BoardSkeleton, S, StockSkeleton } from "./skeletons";
import { Change, Flash, ink, Pairs, Stat, useHereNow, useWarmWhileSeen } from "./bits";
import { Ticker } from "./Ticker";
import { CrewBoard, CrewTrades, Money, Positions, TradeDock, useFillNotice, Waiting, WhoHolds, YourPosition } from "./Trade";
import { StockSearch } from "./Search";
import { report, savedRange, warmBoard, warmRanges, warmStock } from "./warm";

// Stonks: the S&P 500's twenty biggest companies, ranked by their share of the index, live.
// Prices stream in from the stonks sidecar through convex/stonks.ts; every phone sees each trade the
// moment Convex has it. Pre-market and after hours count: the day's chart runs 4am to 8pm New York.
//
// Fast on purpose: what you can tap next is already subscribed (./warm.ts), so a stock opens from cache
// in the frame you tap it; every height is fixed and the skeletons are the same size (./skeletons.tsx),
// so nothing moves when data lands; rows only re-render when their own numbers change.

const HOUR = 3600_000;
const dayDomain = (open: number, close: number): [number, number] => [open - 5.5 * HOUR, close + 4 * HOUR];
// The 1D axis runs 4am to 8pm for anything that trades then; the index (and anything with no extended
// hours yet) gets just the session, so its line fills the chart.
function axisFor(open: number, close: number, points: Point[], q?: { time: number } | null): [number, number] {
  const [from, to] = dayDomain(open, close);
  // The closing auction prints a few minutes after the bell; that's still the session.
  const late = close + 5 * 60_000;
  const outside = (t: number) => t >= from && t <= to && (t < open - 60_000 || t >= late);
  const extended = points.some((p) => outside(p[0])) || (!!q && outside(q.time));
  return extended ? [from, to] : [open, close];
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
  const [range, setRange] = useState<Range>(savedRange);
  return [range, (r) => (localStorage.setItem("stonks-range", r), setRange(r))];
}

// Pro mode: the numbers traders want, one tap in the corner of either screen, remembered on the phone.
const proListeners = new Set<() => void>();
const proOn = () => localStorage.getItem("stonks-pro") === "1";
function usePro(): [boolean, () => void] {
  const pro = useSyncExternalStore(
    (cb) => (proListeners.add(cb), () => proListeners.delete(cb)),
    proOn,
    () => false,
  );
  return [pro, () => (localStorage.setItem("stonks-pro", pro ? "0" : "1"), proListeners.forEach((l) => l()))];
}

function ProToggle() {
  const [pro, toggle] = usePro();
  return (
    <button
      type="button"
      aria-pressed={pro}
      aria-label="Pro mode"
      onClick={toggle}
      className={cn(
        "grid size-11 place-items-center rounded-full text-footnote font-bold transition-[transform,background-color,color] duration-100 active:scale-[0.97]",
        pro ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      Pro
    </button>
  );
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

const dirOf = (p?: number, base?: number): Dir => (p !== undefined && base !== undefined && p < base ? "down" : "up");
const sourceName = (s: string) => ({ yahoo: "Yahoo", nasdaq: "Nasdaq", history: "Yahoo" })[s] ?? s;

// ---- The board ----

type Board = FunctionReturnType<typeof api.stonks.board>;
type BoardRow = Board["rows"][number];

export function StonksBoard() {
  const convex = useConvex();
  const board = useQuery(api.stonks.board);
  const sparks = useQuery(api.stonks.sparks);
  const market = useQuery(api.stonks.profile, { symbol: INDEX });
  const me = useQuery(api.stonks.portfolio);
  const crew = useQuery(api.stonks.crew);
  const trades = useQuery(api.stonks.trades, {});
  const history = useQuery(api.stonks.worthHistory);
  useHereNow();
  useFillNotice(me);
  const [searching, setSearching] = useState(false);
  const [pro] = usePro();
  const now = useNow(15_000);
  const clock = marketClock(now);
  useEffect(() => {
    warmBoard(convex, 180_000);
    warmRanges(convex, INDEX);
  }, [convex]);
  if (board === undefined || !me || crew === undefined || history === undefined) return <BoardSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <NavBar title="Stonks" back="/games" action={<ProToggle />} />
      <StockSearch onActive={setSearching} />
      {searching ? null : (
        <>
          <Money me={me} crew={crew} />
          <CrewBoard crew={crew} history={history} />
          <Positions me={me} />
          <Waiting orders={me.waiting} now={now} />
          <CrewTrades trades={trades ?? []} now={now} />
          <StockChart symbol={INDEX} quote={board.index ?? undefined} title="S&P 500" />
          <Group>
            <RangeRow label="Today" low={board.index?.dayLow} high={board.index?.dayHigh} value={board.index?.price} unit="" />
            <RangeRow label="52 weeks" low={board.index?.yearLow} high={board.index?.yearHigh} value={board.index?.price} unit="" />
          </Group>
          {board.movers.length > 0 && <Movers movers={board.movers} />}
          {board.rows.length === 0 ? (
            <p className="px-1 text-callout text-muted-foreground">Waiting for prices</p>
          ) : (
            <Section title={`Top ${board.rows.length}`} action={<Breadth up={board.up} down={board.down} />}>
              {board.rows.map((r) => (
                <Row key={r.symbol} r={r} spark={sparks?.[r.symbol]} open={clock.day.open} close={clock.day.close} pro={pro} now={now} />
              ))}
            </Section>
          )}
          {market && market.news.length > 0 && <News title="Market news" items={market.news.slice(0, 5)} now={now} />}
          <Sources board={board} now={now} />
        </>
      )}
    </div>
  );
}

function Breadth({ up, down }: { up: number; down: number }) {
  return (
    <span className="flex items-center gap-2.5 pb-0.5 text-footnote font-semibold text-muted-foreground tabular-nums" aria-label={`${up} up, ${down} down`}>
      <span className="flex items-center gap-0.5">
        <CaretUpIcon weight="fill" style={{ color: ink("up") }} aria-hidden />
        {up}
      </span>
      <span className="flex items-center gap-0.5">
        <CaretDownIcon weight="fill" style={{ color: ink("down") }} aria-hidden />
        {down}
      </span>
    </span>
  );
}

// A row only re-renders when one of its own numbers changes, so a trade in one stock doesn't redraw 20.
const Row = memo(
  function Row({ r, spark, open, close, pro, now }: { r: BoardRow; spark?: Point[]; open: number; close: number; pro: boolean; now: number }) {
    const convex = useConvex();
    const ref = useWarmWhileSeen<HTMLDivElement>(r.symbol);
    const points = useMemo(() => withLive(spark ?? [], r, dayDomain(open, close)), [spark, r, open, close]);
    const domain = useMemo(() => axisFor(open, close, points, r), [open, close, points, r]);
    const moved = r.baseRank - r.rank; // places climbed since the previous close
    const earnings = r.earnings && r.earnings > now - 12 * HOUR && r.earnings - now < 6 * 86_400_000 ? r.earnings : null;
    return (
      <motion.div ref={ref} layout="position" transition={{ type: "spring", bounce: 0, duration: 0.5 }}>
        <Link
          to={`/stonks/${encodeURIComponent(r.symbol)}`}
          onPointerDown={() => warmStock(convex, r.symbol, "open")}
          className={`flex ${S.row} items-center gap-3 px-4 transition-transform duration-100 active:scale-[0.97]`}
          aria-label={`${display(r.symbol)}, ${r.name}`}
        >
          <span className="flex w-5 shrink-0 flex-col items-end">
            <span className="text-footnote font-semibold text-muted-foreground tabular-nums">{r.rank}</span>
            <AnimatePresence initial={false}>
              {moved !== 0 && (
                <motion.span
                  key={moved}
                  initial={{ scale: 0.3, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.3, opacity: 0 }}
                  transition={{ type: "spring", bounce: 0.4, duration: 0.45 }}
                  className="flex items-center text-caption font-bold tabular-nums"
                  aria-label={moved > 0 ? `up ${moved} today` : `down ${-moved} today`}
                >
                  {moved > 0 ? <CaretUpIcon weight="fill" style={{ color: ink("up") }} /> : <CaretDownIcon weight="fill" style={{ color: ink("down") }} />}
                  {Math.abs(moved)}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="font-display text-body">{display(r.symbol)}</span>
              {earnings && (
                <span
                  className="flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-muted px-1.5 text-caption font-semibold text-muted-foreground"
                  aria-label={`Earnings ${soon(earnings, now)}`}
                >
                  <CalendarBlankIcon weight="bold" aria-hidden />
                  {soon(earnings, now)}
                </span>
              )}
            </span>
            <span className="block truncate text-footnote text-muted-foreground">
              {weight(r.weight)} · {pro && r.relVolume ? `${r.relVolume.toFixed(1)}× volume` : r.name}
            </span>
          </span>
          <Sparkline points={points} baseline={r.prevClose} domain={domain} dir={dirOf(r.price, r.prevClose)} />
          <span className="flex w-[92px] shrink-0 flex-col items-end gap-1">
            <Flash value={r.price} className="text-callout font-semibold">
              <Ticker value={r.price} text={price(r.price)} />
            </Flash>
            {r.prevClose ? <Change change={r.price - r.prevClose} base={r.prevClose} small /> : null}
          </span>
        </Link>
      </motion.div>
    );
  },
  (a, b) =>
    a.r.price === b.r.price &&
    a.r.time === b.r.time &&
    a.r.rank === b.r.rank &&
    a.r.baseRank === b.r.baseRank &&
    a.r.prevClose === b.r.prevClose &&
    a.r.relVolume === b.r.relVolume &&
    a.r.earnings === b.r.earnings &&
    Math.abs(a.r.weight - b.r.weight) < 0.005 &&
    a.spark === b.spark &&
    a.open === b.open &&
    a.pro === b.pro &&
    Math.floor(a.now / HOUR) === Math.floor(b.now / HOUR),
);

// Who moved the S&P today, in index points: each bar is a stock's share at the close times its move.
// One diverging bar chart, up to the right and down to the left of a zero line.
function Movers({ movers }: { movers: Board["movers"] }) {
  const convex = useConvex();
  const max = Math.max(...movers.map((m) => Math.abs(m.points)), 0.01);
  return (
    <Section title="Moving the S&P" action={<span className="pb-0.5 text-footnote font-medium text-muted-foreground">Index points</span>}>
      {movers.map((m) => {
        const d: Dir = m.points < 0 ? "down" : "up";
        return (
          <MoverRow key={m.symbol} symbol={m.symbol}>
            <Link
              to={`/stonks/${encodeURIComponent(m.symbol)}`}
              onPointerDown={() => warmStock(convex, m.symbol, "open")}
              className={`grid ${S.mover} grid-cols-[52px_minmax(0,1fr)_56px] items-center gap-2 px-4 transition-transform duration-100 active:scale-[0.97]`}
              aria-label={`${display(m.symbol)} moved the S&P ${pts(m.points)} points`}
            >
              <span className="font-display text-callout">{display(m.symbol)}</span>
              <span className="relative h-2.5" aria-hidden>
                <span className="absolute -top-1 left-1/2 h-[18px] w-px bg-border" />
                <motion.span
                  className={cn("absolute top-0 h-full", d === "up" ? "left-1/2 rounded-r-[3px]" : "right-1/2 rounded-l-[3px]")}
                  style={{ background: ink(d) }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(Math.abs(m.points) / max) * 50}%` }}
                  transition={{ type: "spring", bounce: 0, duration: 0.6 }}
                />
              </span>
              <span className="text-right text-footnote font-semibold tabular-nums">{pts(m.points)}</span>
            </Link>
          </MoverRow>
        );
      })}
    </Section>
  );
}

function MoverRow({ symbol, children }: { symbol: string; children: ReactNode }) {
  const ref = useWarmWhileSeen<HTMLDivElement>(symbol);
  return <div ref={ref}>{children}</div>;
}

function Sources({ board, now }: { board: Board; now: number }) {
  const down = board.feeds.filter((f) => f.state === "down");
  const using = [
    ...new Set(
      board.rows
        .map((r) => r.source)
        .filter((s) => s && s !== "history")
        .map(sourceName),
    ),
  ];
  const parts = [
    using.length > 0 && `Prices from ${using.join(" and ")}`,
    board.asOf && `weights from SPY, ${asOfDay(board.asOf)}`,
    board.rows.length > 0 && `the top ${board.rows.length} are ${weight(board.share)} of the index`,
    ...down.map((f) => `${sourceName(f.source)} down ${ago(now - f.at)}`),
  ];
  return <p className="px-1 text-footnote text-muted-foreground">{parts.filter(Boolean).join(" · ")}</p>;
}

// ---- One stock's chart, with its price above it ----

function StockChart({ symbol, quote, title, stats }: { symbol: string; quote: QuoteView | undefined; title?: string; stats?: ProfileStats | null }) {
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
  if (!market.late && earnings && earnings > now - 12 * HOUR && earnings - now < 6 * 86_400_000)
    return <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-footnote font-semibold text-muted-foreground">Earnings {soon(earnings, now)}</span>;
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-footnote font-medium text-muted-foreground">
      {market.open && <span className="size-2 rounded-full bg-online" />}
      {text}
      {market.open && market.late > 0 && ` · ${market.late} min late`}
    </span>
  );
}

// A range as a track with a dot where the price is: today's low to high, the year's, analysts' targets.
function RangeRow({ label, low, high, value, unit, mark }: { label: string; low?: number; high?: number; value?: number; unit: string; mark?: { at: number; name: string } }) {
  const known = low !== undefined && high !== undefined && high > low;
  const at = (x: number) => `${Math.max(0, Math.min(1, (x - low!) / (high! - low!))) * 100}%`;
  return (
    <div className={`${S.range} flex flex-col justify-center gap-2.5 px-4`} aria-label={known ? `${label}: ${price(low, unit)} to ${price(high, unit)}` : label}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-callout text-muted-foreground">{label}</span>
        <span className="text-callout font-semibold tabular-nums">{known ? `${price(low, unit)} – ${price(high, unit)}` : "—"}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted" aria-hidden>
        {known && mark && <span className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-muted-foreground" style={{ left: at(mark.at) }} title={mark.name} />}
        {known && value !== undefined && (
          <motion.span
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
            initial={false}
            animate={{ left: at(value) }}
            transition={{ type: "spring", bounce: 0, duration: 0.5 }}
          />
        )}
      </div>
    </div>
  );
}

function News({ title, items, now }: { title: string; items: NewsItem[]; now: number }) {
  return (
    <Section title={title}>
      {items.map((n) => (
        <a
          key={n.link}
          href={n.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[84px] items-center gap-3 px-4 py-3 transition-transform duration-100 active:scale-[0.97]"
        >
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-callout font-semibold">{n.title}</span>
            <span className="mt-1 flex items-center gap-1 text-footnote text-muted-foreground">
              <span className="truncate">{n.publisher}</span>
              <span className="shrink-0">· {ago(now - n.time)}</span>
              <ArrowSquareOutIcon className="shrink-0" aria-label="opens outside the app" />
            </span>
          </span>
          {n.thumb ? <img src={n.thumb} alt="" width={56} height={56} loading="lazy" decoding="async" className="size-14 shrink-0 rounded-sm bg-muted object-cover" /> : null}
        </a>
      ))}
    </Section>
  );
}

// ---- One stock ----

export function StockPage() {
  const { symbol = "" } = useParams();
  const convex = useConvex();
  const quote = useQuery(api.stonks.quote, { symbol });
  const profile = useQuery(api.stonks.profile, { symbol });
  const dayChart = useQuery(api.stonks.chart, { symbol, range: "1D" });
  const me = useQuery(api.stonks.portfolio);
  const holders = useQuery(api.stonks.holders, { symbol });
  const trades = useQuery(api.stonks.trades, { symbol });
  useFillNotice(me);
  const [pro] = usePro();
  const now = useNow(5_000);
  useEffect(() => {
    warmRanges(convex, symbol);
    warmBoard(convex); // back to the board is instant too
    // Open on a phone: keep it streaming, with its charts, stats and news fresh.
    report(convex, symbol, "open");
    const i = setInterval(() => report(convex, symbol, "open"), 45_000);
    return () => clearInterval(i);
  }, [convex, symbol]);
  // Something nobody's looked at yet: its first quote is a moment away. Yahoo not knowing it takes longer.
  const [opened] = useState(() => Date.now());
  const givenUp = quote === null && now - opened > 8_000;
  if (quote === undefined || !me || (quote === null && !givenUp)) return <StockSkeleton />;
  if (quote === null)
    return (
      <div className="flex flex-col gap-6">
        <NavBar title={display(symbol)} back="/stonks" />
        <p className="px-1 text-callout text-muted-foreground">No prices for {display(symbol)}</p>
      </div>
    );

  const stats = profile?.stats ?? null;
  const market = marketOf(quote, now);
  const unit = unitOf(quote);
  const open = market.day && dayChart?.points.find((p) => p[0] >= market.day!.open && p[0] < market.day!.close)?.[1];
  const moved = quote.rank && quote.baseRank ? quote.baseRank - quote.rank : 0;
  const held = me.positions.find((p) => p.symbol === symbol);

  return (
    <div className="flex flex-col gap-6">
      <NavBar title={display(symbol)} subtitle={quote.name ?? display(symbol)} back="/stonks" action={<ProToggle />} />
      <StockChart symbol={symbol} quote={quote} title={quote.name ?? display(symbol)} stats={stats} />
      {held && <YourPosition p={held} />}
      <Waiting orders={me.waiting.filter((o) => o.symbol === symbol)} now={now} />
      <Section title="Stats">
        <RangeRow label="Today" low={quote.dayLow} high={quote.dayHigh} value={quote.price} unit={unit} />
        <RangeRow label="52 weeks" low={quote.yearLow} high={quote.yearHigh} value={quote.price} unit={unit} />
        {quote.weight !== undefined && (
          <Stat label="Share of the S&P 500">
            {weight(quote.weight)}
            {quote.rank ? ` · #${quote.rank}` : ""}
            {moved !== 0 && (
              <span className="ml-1 inline-flex items-center text-footnote">
                {moved > 0 ? <CaretUpIcon weight="fill" style={{ color: ink("up") }} /> : <CaretDownIcon weight="fill" style={{ color: ink("down") }} />}
                {Math.abs(moved)}
              </span>
            )}
          </Stat>
        )}
        {quote.points !== undefined && <Stat label="Moved the S&P today">{`${pts(quote.points)} points`}</Stat>}
        <Stat label="Open">{open !== undefined && open !== null ? price(open, unit) : "—"}</Stat>
        <Stat label="Previous close">{quote.prevClose !== undefined ? price(quote.prevClose, unit) : "—"}</Stat>
        <Stat label="Volume">
          {quote.volume !== undefined ? `${count(quote.volume)}${stats?.avgVolume ? ` · ${(quote.volume / stats.avgVolume).toFixed(1)}× normal` : ""}` : "—"}
        </Stat>
        <Stat label="Last trade">{`${tradeTime(quote.time, now)} · ${sourceName(quote.source)}`}</Stat>
      </Section>
      <AnimatePresence initial={false}>
        {pro && stats && (
          <motion.div
            key="pro"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            className="flex flex-col gap-6"
          >
            <ProStats stats={stats} price={quote.price} unit={unit} />
          </motion.div>
        )}
      </AnimatePresence>
      <WhoHolds holders={holders ?? []} />
      <CrewTrades trades={trades ?? []} now={now} title="Trades in this stock" />
      {profile && profile.news.length > 0 && <News title="News" items={profile.news} now={now} />}
      <TradeDock symbol={symbol} last={quote.price} unit={unit} rate={quote.rate} me={me} market={market} />
    </div>
  );
}

function ProStats({ stats: s, price: p, unit }: { stats: ProfileStats; price: number; unit: string }) {
  const [more, setMore] = useState(false);
  const opt = <T,>(x: T | undefined, f: (x: T) => string) => (x === undefined ? undefined : f(x));
  return (
    <>
      <section aria-label="Key stats">
        <div className="flex items-end justify-between px-1 pb-2.5">
          <h2 className="font-display text-heading">Key stats</h2>
        </div>
        <Pairs
          items={[
            ["Market cap", opt(s.marketCap, (x) => big(x, true))],
            ["Beta", opt(s.beta, ratio)],
            ["P/E", opt(s.trailingPE, ratio)],
            ["Forward P/E", opt(s.forwardPE, ratio)],
            ["EPS", opt(s.eps, (x) => price(x, unit))],
            ["Dividend yield", opt(s.dividendYield, (x) => frac(x))],
            ["Avg volume", opt(s.avgVolume, count)],
            ["Shares", opt(s.shares, count)],
            ["50-day avg", opt(s.fiftyDay, (x) => price(x, unit))],
            ["200-day avg", opt(s.twoHundredDay, (x) => price(x, unit))],
            ["Profit margin", opt(s.profitMargin, (x) => frac(x))],
            ["Revenue growth", opt(s.revenueGrowth, (x) => frac(x, true))],
            ["Short of float", opt(s.shortOfFloat, (x) => frac(x))],
            ["Ex-dividend", opt(s.exDividend, dayOf)],
            ["Next earnings", opt(s.earnings, (t) => `${dayOf(t)}${s.epsEstimate !== undefined ? ` · est. ${price(s.epsEstimate, unit)}` : ""}`)],
          ]}
        />
      </section>
      {s.targetMean !== undefined && (
        <Section title="Analysts">
          <RangeRow label="Price targets" low={s.targetLow} high={s.targetHigh} value={p} unit={unit} mark={{ at: s.targetMean, name: "Mean target" }} />
          <Stat label="Mean target">
            {price(s.targetMean, unit)}
            <span className="ml-1 text-footnote text-muted-foreground">({frac(s.targetMean / p - 1, true)})</span>
          </Stat>
          {s.rating && <Stat label="Rating">{`${RATING[s.rating] ?? s.rating}${s.analysts ? ` · ${s.analysts} analysts` : ""}`}</Stat>}
        </Section>
      )}
      {(s.summary || s.sector) && (
        <Section title="About">
          <div className="flex flex-col gap-2 px-4 py-3">
            {(s.sector || s.employees) && (
              <span className="text-footnote font-semibold text-muted-foreground">
                {[s.sector, s.industry, s.employees && `${count(s.employees)} people`].filter(Boolean).join(" · ")}
              </span>
            )}
            {s.summary && (
              <button type="button" onClick={() => setMore((m) => !m)} className={cn("text-left text-callout", !more && "line-clamp-4")} aria-expanded={more}>
                {s.summary}
              </button>
            )}
            {s.website && (
              <a href={s.website} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-1 text-callout font-semibold text-primary">
                {s.website.replace(/^https?:\/\/(www\.)?/, "")}
                <ArrowSquareOutIcon aria-label="opens outside the app" />
              </a>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

export { PlayerPage } from "./Profile";

export default StonksBoard;
