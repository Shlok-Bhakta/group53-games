import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useConvex, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowSquareOutIcon, CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import { display, marketOf } from "../../../convex/stonks/market";
import type { ProfileStats } from "../../../convex/stonks/profile";
import { NavBar } from "@/components/AppHeader";
import { Section } from "@/components/parts";
import { useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ink, Pairs, RangeRow, Stat } from "./bits";
import { CrewTrades } from "./Crew";
import { big, count, dayOf, frac, price, pts, RATING, ratio, sourceName, tradeTime, unitOf, weight } from "./format";
import { News } from "./News";
import { Waiting, WhoHolds, YourPosition } from "./Positions";
import { ProToggle, usePro } from "./pro";
import { StockSkeleton } from "./skeletons";
import { StockChart } from "./StockChart";
import { useFillNotice } from "./Trade";
import { TradeDock } from "./TradeDock";
import { report, warmBoard, warmRanges } from "./warm";

// One stock: its chart, your position, its stats (and Pro's), the crew in it, its news, and Buy at your thumb.
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
      <Section title="Key stats" bare>
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
      </Section>
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
