import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConvex } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { Group } from "@/components/parts";
import { cn } from "@/lib/utils";
import { CUSTOM_COLOR_FRAMES } from "../../../convex/profileOptions";
import { INDEX } from "../../../convex/stonks/market";
import type { Dir } from "./Chart";
import { percent, price, signed } from "./format";
import { S } from "./skeletons";
import { Ticker } from "./Ticker";
import { report, warmStock } from "./warm";

// Pieces the market and the trading screens share.

export const ink = (d: Dir) => `var(--${d})`;

/** Keeps a stock warm while its row is on screen, or about to be (within 120px of it): its page opens
 *  from cache. Rows further away aren't, so a long list stays light. */
export function useWarmWhileSeen<T extends Element>(symbol: string) {
  const convex = useConvex();
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        clearInterval(timer);
        if (!e.isIntersecting) return;
        warmStock(convex, symbol);
        timer = setInterval(() => warmStock(convex, symbol), 45_000);
      },
      { rootMargin: "120px 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearInterval(timer);
    };
  }, [convex, symbol]);
  return ref;
}

/** Someone's on this screen: prices get written trade by trade while anyone is (`stonks:hot`), and once a minute otherwise. */
export function useHereNow() {
  const convex = useConvex();
  useEffect(() => {
    const beat = () => report(convex, INDEX, "seen");
    beat();
    const timer = setInterval(beat, 45_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [convex]);
}

// A price that just changed lights up for a moment, green if it went up and red if it went down.
export function Flash({ value, className, children }: { value: number; className?: string; children: ReactNode }) {
  const prev = useRef(value);
  const [hit, setHit] = useState<{ dir: Dir; n: number } | null>(null);
  useEffect(() => {
    if (value !== prev.current)
      setHit((h) => ({
        dir: value > prev.current ? "up" : "down",
        n: (h?.n ?? 0) + 1,
      }));
    prev.current = value;
  }, [value]);
  return (
    <span className={cn("relative -mx-1 rounded-sm px-1", className)}>
      <AnimatePresence>
        {hit && (
          <motion.span
            key={hit.n}
            aria-hidden
            className="absolute inset-0 rounded-sm"
            style={{
              background: `color-mix(in oklch, var(--${hit.dir}) 28%, transparent)`,
            }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      <span className="relative">{children}</span>
    </span>
  );
}

// "▲ +1.23 (0.45%)": the caret carries the color; the numbers stay in text color, with a sign, so up and
// down never depend on telling green from red. The numbers roll when they change.
export function Change({ change, base, unit, small, label, instant }: { change: number; base: number; unit?: string; small?: boolean; label?: string; instant?: boolean }) {
  const dir: Dir = change < 0 ? "down" : "up";
  const Icon = dir === "up" ? CaretUpIcon : CaretDownIcon;
  const pct = (change / base) * 100;
  const text = small ? `${change < 0 ? "−" : "+"}${percent(pct)}` : `${signed(change, unit)} (${percent(pct)})`;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap font-semibold", small ? "text-footnote" : "text-callout")}>
      <Icon weight="fill" className="shrink-0" style={{ color: ink(dir) }} aria-label={dir} />
      <Ticker value={change} text={text} instant={instant} />
      {label && <span className="font-medium text-muted-foreground">{label}</span>}
    </span>
  );
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={`flex ${S.stat} items-center justify-between gap-3 px-4`}>
      <span className="text-callout text-muted-foreground">{label}</span>
      <span className="flex items-center text-callout font-semibold tabular-nums">{children}</span>
    </div>
  );
}

// A range as a track with a dot where the price is: today's low to high, the year's, analysts' targets.
export function RangeRow({ label, low, high, value, unit, mark }: { label: string; low?: number; high?: number; value?: number; unit: string; mark?: { at: number; name: string } }) {
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

// Two numbers to a row, the way trading apps pack them.
export function Pairs({ items }: { items: [string, string | undefined][] }) {
  const shown = items.filter((i): i is [string, string] => i[1] !== undefined);
  const rows: [string, string][][] = [];
  for (let i = 0; i < shown.length; i += 2) rows.push(shown.slice(i, i + 2));
  return (
    <Group>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-2 divide-x divide-border">
          {row.map(([label, value]) => (
            <div key={label} className={cn("flex min-h-14 flex-col justify-center px-4 py-2", row.length === 1 && "col-span-2")}>
              <span className="text-footnote text-muted-foreground">{label}</span>
              <span className="text-callout font-semibold tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      ))}
    </Group>
  );
}

type Colored = { color: string; dash?: string };
// The color a card's frame shows: picked for these, built in for the rest. Holo and RGB are every color, so none.
const FRAME_HUES: Record<string, string> = { gold: "#e3b341", fire: "#e5484d", ice: "#22d3ee", toxic: "#5fae57" };
// Too light to see on a light theme, as a line.
const UNUSABLE = new Set(["#f8fafc"]);
export function cardColor(frame?: string, frameColor?: string) {
  if (!frame) return undefined;
  const own = (CUSTOM_COLOR_FRAMES as readonly string[]).includes(frame) ? frameColor : FRAME_HUES[frame];
  return own && !UNUSABLE.has(own) ? own : undefined;
}

/** Each player's color on the charts, the same for the whole game whoever's winning: their own frame's color if
 *  they've customized one that's free, otherwise the next fixed slot. Past eight players, slots repeat dashed. */
export function playerColors(crew: { userId: string; joinedAt: number; frame?: string; frameColor?: string }[]) {
  const taken = new Set<string>();
  const out = new Map<string, Colored>();
  const byJoin = [...crew].sort((a, b) => a.joinedAt - b.joinedAt);
  // Frame colors first, so a slot never takes one someone chose; the slots are themselves distinct hues.
  for (const c of byJoin) {
    const own = cardColor(c.frame, c.frameColor);
    if (own && !taken.has(own)) {
      taken.add(own);
      out.set(c.userId, { color: own });
    }
  }
  let slot = 0;
  for (const c of byJoin) {
    if (out.has(c.userId)) continue;
    out.set(c.userId, { color: `var(--series-${(slot % 8) + 1})`, dash: slot >= 8 ? "6 4" : undefined });
    slot++;
  }
  return out;
}

/** A position's color by how it's doing: paler for a small move, darker the bigger the gain or loss. */
export function gainColor(pct: number) {
  const size = Math.abs(pct);
  if (size < 0.0025) return "color-mix(in oklch, var(--muted-foreground) 45%, var(--card))";
  const hue = pct > 0 ? "var(--up)" : "var(--down)";
  if (size < 0.02) return `color-mix(in oklch, ${hue} 45%, white)`;
  if (size < 0.05) return `color-mix(in oklch, ${hue} 72%, white)`;
  if (size < 0.1) return hue;
  return `color-mix(in oklch, ${hue} var(--deep), black)`;
}
