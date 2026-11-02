import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { motion } from "motion/react";
import { Slider } from "radix-ui";
import { toast } from "sonner";
import { CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { display, marketOf, type Market } from "../../../convex/stonks/market";
import { MIN_ORDER, type Side } from "../../../convex/stonks/trade";
import { AsyncButton } from "@/components/AsyncButton";
import { Group, Section } from "@/components/parts";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { sfx } from "@/sound";
import type { Point } from "../../../convex/stonks/board";
import { Change, Flash, playerColors, useWarmWhileSeen } from "./bits";
import { CrewChart, valueAt, type Series } from "./Chart";
import { ago, frac, opensAt, price, shareCount } from "./format";
import { S } from "./skeletons";
import { Ticker } from "./Ticker";
import { playerPath, warmPlayer, warmStock } from "./warm";

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

// ---- The board ----

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
    <section aria-label="Crew">
      <div className="flex items-end justify-between px-1 pb-2.5">
        <h2 className="font-display text-heading">Crew</h2>
      </div>
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
    </section>
  );
}

export function PositionRow({ p, owner, swatch }: { p: Portfolio["positions"][number]; owner?: string; swatch?: string }) {
  const convex = useConvex();
  const ref = useWarmWhileSeen<HTMLDivElement>(p.symbol);
  const short = p.shares < 0;
  return (
    <motion.div ref={ref} layout="position" transition={{ type: "spring", bounce: 0, duration: 0.5 }}>
      <Link
        to={stockPath(p.symbol)}
        onPointerDown={() => warmStock(convex, p.symbol, "open")}
        aria-label={`${owner ? `${owner}'s` : "Your"} position in ${display(p.symbol)}`}
        className={`flex ${S.row} items-center gap-3 px-4 transition-transform duration-100 active:scale-[0.97]`}
      >
        {swatch && <span className="size-3 shrink-0 rounded-sm" style={{ background: swatch }} aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block font-display text-body">{display(p.symbol)}</span>
          <span className="block truncate text-footnote text-muted-foreground">
            {short ? "Short " : ""}
            {shareCount(p.shares, p.symbol)} at {price(p.avg)}
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

export function Waiting({ orders, now, readOnly }: { orders: Portfolio["waiting"]; now: number; readOnly?: boolean }) {
  const cancel = useMutation(api.stonks.cancelOrder);
  if (orders.length === 0) return null;
  return (
    <Section title="Waiting to fill">
      {orders.map((o) => (
        <div key={o.id} className={`flex ${S.row} items-center gap-3 px-4`}>
          <Link to={stockPath(o.symbol)} className="min-w-0 flex-1 transition-transform duration-100 active:scale-[0.97]">
            <span className="block truncate text-callout font-semibold">
              {VERB[o.side]} {o.dollars !== undefined ? `${price(o.dollars)} of ` : o.shares !== undefined ? `${shareCount(o.shares, o.symbol)} of ` : "all of "}
              {display(o.symbol)}
            </span>
            <span className="block text-footnote text-muted-foreground">{whenFills(marketOf(o.quote, now))}</span>
          </Link>
          {!readOnly && <AsyncButton variant="ghost" size="icon" aria-label={`Cancel ${VERB[o.side]} ${display(o.symbol)}`} icon={<XIcon weight="bold" />} onClick={() => cancel({ id: o.id as Id<"stockOrders"> })} />}
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
        <div key={t.id} className={`flex ${S.crew} items-center gap-3 px-4`}>
          <Link to={playerPath(t.userId)} aria-label={`${t.name}'s profile`} className="grid size-11 shrink-0 place-items-center transition-transform duration-100 active:scale-[0.97]">
            <PlayerAvatar name={t.name} image={t.image} size={32} />
          </Link>
          <Link to={stockPath(t.symbol)} className="min-w-0 flex-1 transition-transform duration-100 active:scale-[0.97]">
            <span className="block truncate text-callout font-semibold">
              {t.name} {DID[t.side]} {display(t.symbol)}
            </span>
            <span className="block truncate text-footnote text-muted-foreground">
              {price(t.amount)} at {price(t.price, t.currency)} · {ago(now - t.at)}
              {t.realized ? ` · ${t.realized > 0 ? "made" : "lost"} ${price(Math.abs(t.realized))}` : ""}
            </span>
          </Link>
        </div>
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
            {shareCount(p.shares, p.symbol)}
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
        <Link key={h.userId} to={playerPath(h.userId)} aria-label={`${h.name}'s profile`} className={`flex ${S.crew} items-center gap-3 px-4 transition-transform duration-100 active:scale-[0.97]`}>
          <PlayerAvatar name={h.name} image={h.image} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-callout font-semibold">{h.name}</span>
            <span className="block text-footnote text-muted-foreground">{h.shares < 0 ? "Short" : "Long"}</span>
          </span>
          <span className="shrink-0 text-footnote font-semibold tabular-nums">{frac(h.gainPct, true)}</span>
        </Link>
      ))}
    </Section>
  );
}

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
        <Button size="xl" className="h-14 flex-1" disabled={rate === undefined || (!closes(primary.side) && !canOpen)} onClick={() => setSide(primary.side)}>
          {primary.label}
        </Button>
        <Button size="xl" variant="secondary" className="h-14 flex-1" disabled={rate === undefined || !canOpen} onClick={() => setSide(secondary.side)}>
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
              About {shareCount(shares, symbol)} at {price(last, unit)}
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
            <span className="font-semibold">{whenFills(market)}</span>
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
