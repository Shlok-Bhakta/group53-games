import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { motion } from "motion/react";
import { Slider } from "radix-ui";
import { toast } from "sonner";
import { XIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { display, type Clock } from "../../../convex/stonks/market";
import { MIN_ORDER, type Side } from "../../../convex/stonks/trade";
import { AsyncButton } from "@/components/AsyncButton";
import { Section } from "@/components/parts";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { sfx } from "@/sound";
import { Change, Flash, useWarmWhileSeen } from "./bits";
import { ago, frac, opensAt, price, shareCount } from "./format";
import { S } from "./skeletons";
import { Ticker } from "./Ticker";
import { warmStock } from "./warm";

// Stonks' paper trading: everyone has $10,000 to buy and short with, and the crew's standings move with
// every price. An order waits for the next trade (convex/stonks.ts), so nobody knows the price they'll
// get when they tap; outside market hours that's the open.

export type Portfolio = NonNullable<FunctionReturnType<typeof api.stonks.portfolio>>;
export type Crew = FunctionReturnType<typeof api.stonks.crew>;
export type Trades = FunctionReturnType<typeof api.stonks.trades>;
export type Holders = FunctionReturnType<typeof api.stonks.holders>;

const VERB: Record<Side, string> = { buy: "Buy", sell: "Sell", short: "Short", cover: "Cover" };
const DID: Record<Side, string> = { buy: "bought", sell: "sold", short: "shorted", cover: "covered" };
const stockPath = (symbol: string) => `/stonks/${encodeURIComponent(symbol)}`;
const whenFills = (clock: Clock) => (clock.state === "open" ? "Next trade" : `At the open, ${opensAt(clock.nextOpen)}`);

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
    toast.success(`${DID[fill.side][0].toUpperCase()}${DID[fill.side].slice(1)} ${price(fill.amount)} of ${display(fill.symbol)} at ${price(fill.price)}`);
  }, [fill, loaded]);
}

// ---- The board ----

export function Money({ me, crew }: { me: Portfolio; crew: Crew }) {
  const place = crew.findIndex((c) => c.me) + 1;
  return (
    <section aria-label="Your money" className="px-1">
      <div className={`flex ${S.heroTop} items-center justify-between gap-3`}>
        <span className="text-callout font-semibold text-muted-foreground">Your money</span>
        {place > 0 && crew.length > 1 && (
          <span className="text-footnote font-medium text-muted-foreground">
            #{place} of {crew.length}
          </span>
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

export function CrewBoard({ crew }: { crew: Crew }) {
  return (
    <Section title="Crew">
      {crew.map((c, i) => (
        <motion.div key={c.userId} layout="position" transition={{ type: "spring", bounce: 0, duration: 0.5 }} className={cn(`flex ${S.crew} items-center gap-3 px-4`, c.me && "bg-accent/40")}>
          <span className="w-4 shrink-0 text-right text-footnote font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
          <PlayerAvatar name={c.name} image={c.image} frame={c.frame} frameColor={c.frameColor} glow={c.glow} badge={c.badge} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-callout font-semibold">{c.name}</span>
            <span className="block text-footnote text-muted-foreground">
              {c.positions === 0 ? "All cash" : `${c.positions} ${c.positions === 1 ? "position" : "positions"}`}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <Flash value={c.worth} className="text-callout font-semibold">
              <Ticker value={c.worth} text={price(c.worth)} />
            </Flash>
            <Change change={c.gain} base={10_000} small />
          </span>
        </motion.div>
      ))}
    </Section>
  );
}

function PositionRow({ p }: { p: Portfolio["positions"][number] }) {
  const convex = useConvex();
  const ref = useWarmWhileSeen<HTMLDivElement>(p.symbol);
  const short = p.shares < 0;
  return (
    <motion.div ref={ref} layout="position" transition={{ type: "spring", bounce: 0, duration: 0.5 }}>
      <Link
        to={stockPath(p.symbol)}
        onPointerDown={() => warmStock(convex, p.symbol)}
        aria-label={`Your position in ${display(p.symbol)}`}
        className={`flex ${S.row} items-center gap-3 px-4 transition-transform duration-100 active:scale-[0.97]`}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-display text-body">{display(p.symbol)}</span>
          <span className="block truncate text-footnote text-muted-foreground">
            {short ? "Short " : ""}
            {shareCount(p.shares)} at {price(p.avg)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Flash value={p.price} className="text-callout font-semibold">
            <Ticker value={p.value} text={price(Math.abs(p.value))} />
          </Flash>
          <Change change={p.gain} base={Math.abs(p.shares * p.avg)} small />
        </span>
      </Link>
    </motion.div>
  );
}

export function Positions({ me }: { me: Portfolio }) {
  if (me.positions.length === 0) return null;
  return (
    <Section title="Your positions">
      {me.positions.map((p) => (
        <PositionRow key={p.symbol} p={p} />
      ))}
    </Section>
  );
}

export function Waiting({ orders, clock }: { orders: Portfolio["waiting"]; clock: Clock }) {
  const cancel = useMutation(api.stonks.cancelOrder);
  if (orders.length === 0) return null;
  return (
    <Section title="Waiting to fill">
      {orders.map((o) => (
        <div key={o.id} className={`flex ${S.row} items-center gap-3 px-4`}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-callout font-semibold">
              {VERB[o.side]} {o.dollars !== undefined ? `${price(o.dollars)} of ` : o.shares !== undefined ? `${shareCount(o.shares)} of ` : "all of "}
              {display(o.symbol)}
            </span>
            <span className="block text-footnote text-muted-foreground">{whenFills(clock)}</span>
          </span>
          <AsyncButton variant="ghost" size="icon" aria-label={`Cancel ${VERB[o.side]} ${display(o.symbol)}`} icon={<XIcon weight="bold" />} onClick={() => cancel({ id: o.id as Id<"stockOrders"> })} />
        </div>
      ))}
    </Section>
  );
}

export function CrewTrades({ trades, now, title = "Crew trades" }: { trades: Trades; now: number; title?: string }) {
  if (trades.length === 0) return null;
  return (
    <Section title={title}>
      {trades.slice(0, 6).map((t) => (
        <Link key={t.id} to={stockPath(t.symbol)} className={`flex ${S.crew} items-center gap-3 px-4 transition-transform duration-100 active:scale-[0.97]`}>
          <PlayerAvatar name={t.name} image={t.image} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-callout font-semibold">
              {t.name} {DID[t.side]} {display(t.symbol)}
            </span>
            <span className="block truncate text-footnote text-muted-foreground">
              {price(t.amount)} at {price(t.price)} · {ago(now - t.at)}
              {t.realized ? ` · ${t.realized > 0 ? "made" : "lost"} ${price(Math.abs(t.realized))}` : ""}
            </span>
          </span>
        </Link>
      ))}
    </Section>
  );
}

// ---- A stock ----

export function YourPosition({ p }: { p: Portfolio["positions"][number] }) {
  return (
    <Section title="Your position">
      <div className={`flex ${S.row} items-center justify-between gap-3 px-4`}>
        <span className="min-w-0">
          <span className="block text-callout font-semibold">
            {p.shares < 0 ? "Short " : ""}
            {shareCount(p.shares)}
          </span>
          <span className="block text-footnote text-muted-foreground">at {price(p.avg)}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-callout font-semibold">
            <Ticker value={p.value} text={price(Math.abs(p.value))} />
          </span>
          <span className="flex items-center gap-1.5">
            <Change change={p.gain} base={Math.abs(p.shares * p.avg)} small />
          </span>
        </span>
      </div>
    </Section>
  );
}

export function WhoHolds({ holders }: { holders: Holders }) {
  const others = holders.filter((h) => !h.me);
  if (others.length === 0) return null;
  return (
    <Section title="Crew in this stock">
      {others.map((h) => (
        <div key={h.userId} className={`flex ${S.crew} items-center gap-3 px-4`}>
          <PlayerAvatar name={h.name} image={h.image} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-callout font-semibold">{h.name}</span>
            <span className="block text-footnote text-muted-foreground">{h.shares < 0 ? "Short" : "Long"}</span>
          </span>
          <span className="shrink-0 text-footnote font-semibold tabular-nums">{frac(h.gainPct, true)}</span>
        </div>
      ))}
    </Section>
  );
}

// The two actions you can take, where thumbs are: pinned to the bottom of the screen as it scrolls.
export function TradeDock({ symbol, last, me, clock }: { symbol: string; last: number; me: Portfolio; clock: Clock }) {
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
        <Button size="xl" className="h-14 flex-1" disabled={!closes(primary.side) && !canOpen} onClick={() => setSide(primary.side)}>
          {primary.label}
        </Button>
        <Button size="xl" variant="secondary" className="h-14 flex-1" disabled={!canOpen} onClick={() => setSide(secondary.side)}>
          {secondary.label}
        </Button>
      </div>
      {side && <TradeSheet symbol={symbol} side={side} last={last} free={me.free} held={held?.shares ?? 0} clock={clock} onClose={() => setSide(null)} />}
    </>
  );
}

function TradeSheet({ symbol, side, last, free, held, clock, onClose }: { symbol: string; side: Side; last: number; free: number; held: number; clock: Clock; onClose: () => void }) {
  const order = useMutation(api.stonks.order);
  const closing = side === "sell" || side === "cover";
  // Opening picks dollars, up to what's free; closing picks a share of the position, all of it by default.
  const max = closing ? 100 : Math.floor(free);
  const [amount, setAmount] = useState(() => (closing ? 100 : Math.min(max, Math.max(MIN_ORDER, Math.round(free / 40) * 10))));
  const exactMax = amount >= max;
  const dollars = closing ? (Math.abs(held) * amount * last) / 100 : exactMax ? free : amount;
  const shares = closing ? (Math.abs(held) * amount) / 100 : dollars / last;
  const presets = closing
    ? [25, 50, 75].map((p) => ({ label: `${p}%`, value: p })).concat({ label: "All", value: 100 })
    : [10, 25, 50].map((p) => ({ label: `${p}%`, value: Math.max(MIN_ORDER, Math.round((free * p) / 1000) * 10) })).concat({ label: "Max", value: max });
  const snap = (v: number) => (closing || v >= max || v <= MIN_ORDER ? v : Math.round(v / 10) * 10);
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerHeader className="relative">
          <DrawerTitle>
            {VERB[side]} {display(symbol)}
          </DrawerTitle>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              <XIcon weight="bold" />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <div className="flex flex-col gap-4 px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <div className="text-center">
            <div className="font-display text-title-lg tabular-nums" aria-live="polite">
              {price(dollars)}
            </div>
            <div className="text-footnote text-muted-foreground">
              About {shareCount(shares)} at {price(last)}
            </div>
          </div>
          <Slider.Root className="relative flex h-11 touch-none select-none items-center" min={closing ? 1 : MIN_ORDER} max={max} step={1} value={[amount]} onValueChange={([v]) => setAmount(snap(v))} aria-label="Amount">
            <Slider.Track className="relative h-2 grow overflow-hidden rounded-full bg-muted">
              <Slider.Range className="absolute h-full bg-primary" />
            </Slider.Track>
            <Slider.Thumb className="block size-7 rounded-full border-2 border-primary bg-background shadow outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
          </Slider.Root>
          <div className="grid grid-cols-4 gap-2">
            {presets.map((p) => (
              <Button key={p.label} variant={amount === p.value ? "default" : "secondary"} className="h-11 px-1" onClick={() => setAmount(p.value)}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center justify-between text-footnote text-muted-foreground">
            <span>Fills</span>
            <span className="font-semibold">{whenFills(clock)}</span>
          </div>
          <AsyncButton
            size="xl"
            className="h-14 w-full"
            onClick={async () => {
              await order(closing ? { symbol, side, shares: amount >= 100 ? undefined : shares } : { symbol, side, dollars: exactMax ? free : amount });
              sfx("place");
              onClose();
            }}
          >
            {VERB[side]} {price(dollars)}
          </AsyncButton>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
