import { Link } from "react-router";
import { useConvex, useMutation } from "convex/react";
import { motion } from "motion/react";
import { XIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { display, marketOf } from "../../../convex/stonks/market";
import { AsyncButton } from "@/components/AsyncButton";
import { Section } from "@/components/parts";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Change, Flash, useWarmWhileSeen } from "./bits";
import { frac, price, shareCount } from "./format";
import { S } from "./skeletons";
import { Ticker } from "./Ticker";
import { VERB, whenFills, type Holders, type Portfolio } from "./Trade";
import { playerPath, stockPath, warmStock } from "./warm";

// What's held and what's waiting to fill: yours on the board, anyone's on their profile, and on a stock's page,
// your position and who else is in it.

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
