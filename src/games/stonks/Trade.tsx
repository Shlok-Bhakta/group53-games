import { useEffect, useRef } from "react";
import { Link } from "react-router";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { CaretRightIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import { display, type Market } from "../../../convex/stonks/market";
import type { Side } from "../../../convex/stonks/trade";
import { sfx } from "@/sound";
import { Change } from "./bits";
import { opensAt, price } from "./format";
import { S } from "./skeletons";
import { Ticker } from "./Ticker";
import { playerPath } from "./warm";

// Stonks' paper trading: everyone has $10,000 to buy and short with, and the crew's standings move with
// every price. An order waits for the next trade (convex/stonks.ts), so nobody knows the price they'll
// get when they tap; outside market hours that's the open. The crew is in ./Crew.tsx, what's held and
// waiting in ./Positions.tsx, and Buy and Sell in ./TradeDock.tsx.

export type Portfolio = NonNullable<FunctionReturnType<typeof api.stonks.portfolio>>;
export type Crew = FunctionReturnType<typeof api.stonks.crew>;
export type Trades = FunctionReturnType<typeof api.stonks.trades>;
export type Holders = FunctionReturnType<typeof api.stonks.holders>;

export const VERB: Record<Side, string> = { buy: "Buy", sell: "Sell", short: "Short", cover: "Cover" };
export const DID: Record<Side, string> = { buy: "bought", sell: "sold", short: "shorted", cover: "covered" };

/** When an order on this would fill. A late feed means a wait: it fills on a trade stamped after the tap. */
export function whenFills(m: Market) {
  if (m.open) return m.late ? `Next trade, about ${m.late} min` : "Next trade";
  return m.clock ? `At the open, ${opensAt(m.clock.nextOpen)}` : "When it next trades";
}

/** Says so when one of my orders fills while I'm looking. */
export function useFillNotice(me: Portfolio | null | undefined) {
  const seen = useRef<string | null | undefined>(undefined);
  const fill = me?.lastFill;
  const loaded = me !== undefined;
  useEffect(() => {
    if (!loaded) return;
    const id = fill?.id ?? null;
    // What had already filled when the screen opened is old news.
    if (seen.current === undefined || id === seen.current) return void (seen.current = id);
    seen.current = id;
    if (!fill) return;
    sfx("land");
    toast.success(`${DID[fill.side][0].toUpperCase()}${DID[fill.side].slice(1)} ${price(fill.amount)} of ${display(fill.symbol)} at ${price(fill.price, fill.currency)}`);
  }, [fill, loaded]);
}

export function Money({ me, crew }: { me: Portfolio; crew: Crew }) {
  const place = crew.findIndex((c) => c.me) + 1;
  const mine = crew.find((c) => c.me);
  return (
    <section aria-label="Your money" className="px-1">
      <div className={`flex ${S.heroTop} items-center justify-between gap-3`}>
        <span className="text-callout font-semibold text-muted-foreground">Your money</span>
        {mine && (
          <Link to={playerPath(mine.userId)} aria-label="Your profile" className="-mr-1 flex h-11 items-center gap-0.5 pl-3 text-footnote font-medium text-muted-foreground active:scale-[0.97]">
            {crew.length > 1 ? `#${place} of ${crew.length}` : "Your profile"}
            <CaretRightIcon weight="bold" aria-hidden />
          </Link>
        )}
      </div>
      <div className={`flex ${S.heroPrice} items-center font-display text-title-lg`}>
        <Ticker value={me.worth} text={price(me.worth)} />
      </div>
      <div className={`flex ${S.heroLine} items-center`}>
        <Change change={me.gain} base={me.start} label="All time" />
      </div>
      <div className={`flex ${S.heroLine} items-center text-footnote text-muted-foreground`}>{price(Math.max(0, me.free))} free to invest</div>
    </section>
  );
}
