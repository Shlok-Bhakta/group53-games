import { memo, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import { display } from "../../../convex/stonks/market";
import { Group, Section } from "@/components/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Change, useWarmWhileSeen } from "./bits";
import { kindOf, price, unitOf } from "./format";
import { S } from "./skeletons";
import { warmStock } from "./warm";

// Search anything on Yahoo Finance: stocks anywhere, crypto, forex, futures, funds. What's already known
// answers on every keystroke from Convex; a moment after you stop, the sidecar asks Yahoo (once a week per
// search) and what it finds joins the list live. Rows on screen stream their price, and a row you touch
// starts fetching its page.

type Result = FunctionReturnType<typeof api.stonks.search>[number];

// Somewhere to start, to show it's not just US stocks.
const PICKS: { symbol: string; name: string; type?: string }[] = [
  { symbol: "BTC-USD", name: "Bitcoin", type: "CRYPTOCURRENCY" },
  { symbol: "ETH-USD", name: "Ethereum", type: "CRYPTOCURRENCY" },
  { symbol: "GC=F", name: "Gold", type: "FUTURE" },
  { symbol: "CL=F", name: "Crude oil", type: "FUTURE" },
  { symbol: "EURUSD=X", name: "Euro to dollar", type: "CURRENCY" },
  { symbol: "^N225", name: "Nikkei 225", type: "INDEX" },
  { symbol: "7203.T", name: "Toyota, Tokyo" },
  { symbol: "SAP.DE", name: "SAP, Frankfurt" },
];

export function StockSearch({ onActive }: { onActive: (active: boolean) => void }) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lookup = useMutation(api.stonks.lookup);
  const text = q.trim();
  const found = useQuery(api.stonks.search, text ? { q: text } : "skip");
  // Results stay up while the next keystroke's load, so the list never blinks empty.
  const held = useRef<Result[]>([]);
  if (found) held.current = found;
  const active = focused || !!text;
  useEffect(() => onActive(active), [active, onActive]);
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => void lookup({ q: text }).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [text, lookup]);
  const clear = () => {
    setQ("");
    setFocused(false);
    input.current?.blur();
  };
  return (
    <>
      <div className={`relative ${S.search}`}>
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={input}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search anything"
          placeholder="Stocks, crypto, forex, futures"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          // A tap on a result lands before this matters; a tap elsewhere with nothing typed closes it.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          className={`${S.search} rounded-md border-0 bg-muted pr-11 pl-10 text-body [&::-webkit-search-cancel-button]:hidden`}
        />
        {active && (
          <Button variant="ghost" size="icon" aria-label="Clear search" className="absolute top-0 right-0" onClick={clear}>
            <XIcon weight="bold" />
          </Button>
        )}
      </div>
      {text ? (
        held.current.length > 0 ? (
          <Group>
            {held.current.map((r) => (
              <Row key={r.symbol} r={r} />
            ))}
          </Group>
        ) : found ? (
          <p className="px-1 text-callout text-muted-foreground">Asking Yahoo about “{text}”</p>
        ) : null
      ) : (
        focused && (
          <Section title="Not just stocks">
            {PICKS.map((p) => (
              <Row key={p.symbol} r={p} />
            ))}
          </Section>
        )
      )}
    </>
  );
}

type RowData = { symbol: string; name: string; type?: string; exchange?: string; price?: number; prevClose?: number; currency?: string };

const Row = memo(function Row({ r }: { r: RowData }) {
  const convex = useConvex();
  const ref = useWarmWhileSeen<HTMLDivElement>(r.symbol);
  // Once it's on screen it streams, so a row with no price yet gets one in a moment.
  const live = useQuery(api.stonks.quote, { symbol: r.symbol });
  const last = live?.price ?? r.price;
  const prev = live?.prevClose ?? r.prevClose;
  const unit = unitOf(live ?? { type: r.type, currency: r.currency });
  const detail = [kindOf(live?.type ?? r.type), r.exchange].filter(Boolean).join(" · ");
  return (
    <div ref={ref}>
      <Link
        to={`/stonks/${encodeURIComponent(r.symbol)}`}
        onPointerDown={() => warmStock(convex, r.symbol, "open")}
        aria-label={`${display(r.symbol)}, ${live?.name ?? r.name}`}
        className={`flex ${S.row} items-center gap-3 px-4 transition-transform duration-100 active:scale-[0.97]`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-body">{display(r.symbol)}</span>
          <span className="block truncate text-footnote text-muted-foreground">
            {live?.name ?? r.name}
            {detail ? ` · ${detail}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {last !== undefined && <span className="text-callout font-semibold tabular-nums">{price(last, unit)}</span>}
          {last !== undefined && prev ? <Change change={last - prev} base={prev} small /> : null}
        </span>
      </Link>
    </div>
  );
});
