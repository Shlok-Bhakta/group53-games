import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { display, type Market } from "../../../convex/stonks/market";
import { MIN_ORDER, type Side } from "../../../convex/stonks/trade";
import { AmountSheet } from "@/components/AmountSheet";
import { Button } from "@/components/ui/button";
import { sfx } from "@/sound";
import { price, shareCount } from "./format";
import { VERB, whenFills, type Portfolio } from "./Trade";

// The two actions you can take, where thumbs are: pinned to the bottom of the screen as it scrolls.
export function TradeDock({ symbol, last, unit, rate, me, market }: { symbol: string; last: number; unit: string; rate: number | undefined; me: Portfolio; market: Market }) {
  const [side, setSide] = useState<Side | null>(null);
  const held = me.positions.find((p) => p.symbol === symbol);
  const canOpen = me.free >= MIN_ORDER;
  const [primary, secondary]: [{ side: Side; label: string }, { side: Side; label: string }] =
    held === undefined
      ? [
          { side: "buy", label: "Buy" },
          { side: "short", label: "Short" },
        ]
      : held.shares > 0
        ? [
            { side: "sell", label: "Sell" },
            { side: "buy", label: "Buy more" },
          ]
        : [
            { side: "cover", label: "Cover" },
            { side: "short", label: "Short more" },
          ];
  const closes = (s: Side) => s === "sell" || s === "cover";
  return (
    <>
      <div
        className="sticky bottom-0 z-10 -mx-4 flex gap-2.5 bg-linear-to-t from-background from-70% to-transparent px-4 pt-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)", marginBottom: "calc(-1 * (env(safe-area-inset-bottom) + 16px))" }}
      >
        <Button size="xl" className="flex-1" disabled={rate === undefined || (!closes(primary.side) && !canOpen)} onClick={() => setSide(primary.side)}>
          {primary.label}
        </Button>
        <Button size="xl" variant="secondary" className="flex-1" disabled={rate === undefined || !canOpen} onClick={() => setSide(secondary.side)}>
          {secondary.label}
        </Button>
      </div>
      {side && <TradeSheet symbol={symbol} side={side} last={last} unit={unit} usd={last * (rate ?? 1)} free={me.free} held={held?.shares ?? 0} market={market} onClose={() => setSide(null)} />}
    </>
  );
}

function TradeSheet({ symbol, side, last, unit, usd, free, held, market, onClose }: { symbol: string; side: Side; last: number; unit: string; usd: number; free: number; held: number; market: Market; onClose: () => void }) {
  const order = useMutation(api.stonks.order);
  const closing = side === "sell" || side === "cover";
  // Opening picks dollars, up to what's free; closing picks a share of the position, all of it by default.
  const max = closing ? 100 : Math.floor(free);
  const [amount, setAmount] = useState(() => (closing ? 100 : Math.min(max, Math.max(MIN_ORDER, Math.round(free / 40) * 10))));
  const exactMax = amount >= max;
  const dollars = closing ? (Math.abs(held) * amount * usd) / 100 : exactMax ? free : amount;
  const shares = closing ? (Math.abs(held) * amount) / 100 : dollars / usd;
  const presets = closing
    ? [25, 50, 75].map((p) => ({ label: `${p}%`, value: p })).concat({ label: "All", value: 100 })
    : [10, 25, 50].map((p) => ({ label: `${p}%`, value: Math.max(MIN_ORDER, Math.round((free * p) / 1000) * 10) })).concat({ label: "Max", value: max });
  const snap = (v: number) => (closing || v >= max || v <= MIN_ORDER ? v : Math.round(v / 10) * 10);
  return (
    <AmountSheet
      open
      onClose={onClose}
      title={`${VERB[side]} ${display(symbol)}`}
      value={amount}
      onChange={setAmount}
      min={closing ? 1 : MIN_ORDER}
      max={max}
      snap={snap}
      presets={presets}
      display={price(dollars)}
      detail={`About ${shareCount(shares, symbol)} at ${price(last, unit)}`}
      confirm={`${VERB[side]} ${price(dollars)}`}
      onConfirm={async () => {
        await order(closing ? { symbol, side, shares: amount >= 100 ? undefined : shares } : { symbol, side, dollars: exactMax ? free : amount });
        sfx("place");
        onClose();
      }}
    >
      <div className="flex items-center justify-between text-footnote text-muted-foreground">
        <span>Fills</span>
        <span className="font-semibold">{whenFills(market)}</span>
      </div>
    </AmountSheet>
  );
}
