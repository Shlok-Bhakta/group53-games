import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { CalendarBlankIcon, CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Point } from "../../../convex/stonks/board";
import { display, INDEX, marketClock } from "../../../convex/stonks/market";
import { NavBar } from "@/components/AppHeader";
import { Group, Section } from "@/components/parts";
import { ago, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Change, Flash, ink, RangeRow, useHereNow, useWarmWhileSeen } from "./bits";
import { Sparkline, type Dir } from "./Chart";
import { CrewBoard, CrewTrades } from "./Crew";
import { asOfDay, price, pts, soon, sourceName, weight } from "./format";
import { News } from "./News";
import { Positions, Waiting } from "./Positions";
import { usePro, ProToggle } from "./pro";
import { StockSearch } from "./Search";
import { BoardSkeleton, S } from "./skeletons";
import { axisFor, dayDomain, dirOf, earningsSoon, HOUR, StockChart, withLive } from "./StockChart";
import { Ticker } from "./Ticker";
import { Money, useFillNotice } from "./Trade";
import { stockPath, warmBoard, warmRanges, warmStock } from "./warm";

// The board: your money and the crew, then the S&P with its twenty biggest companies, ranked by their share of
// the index, live.

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
    const earnings = earningsSoon(r.earnings, now) ? r.earnings! : null;
    return (
      <motion.div ref={ref} layout="position" transition={{ type: "spring", bounce: 0, duration: 0.5 }}>
        <Link
          to={stockPath(r.symbol)}
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
              to={stockPath(m.symbol)}
              onPointerDown={() => warmStock(convex, m.symbol, "open")}
              className={`grid ${S.mover} grid-cols-[52px_minmax(0,1fr)_56px] items-center gap-2 px-4 transition-transform duration-100 active:scale-[0.97]`}
              aria-label={`${display(m.symbol)} moved the S&P ${pts(m.points)} points`}
            >
              <span className="font-display text-callout">{display(m.symbol)}</span>
              <span className="relative h-2.5" aria-hidden>
                <span className="absolute -top-1 left-1/2 h-[18px] w-px bg-border" />
                {/* A chart mark, not a surface: a bar's free end is rounded 3px, its end on the zero line square. */}
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
    ...down.map((f) => `${sourceName(f.source)} down ${ago(now - f.at, { seconds: true })}`),
  ];
  return <p className="px-1 text-footnote text-muted-foreground">{parts.filter(Boolean).join(" · ")}</p>;
}
