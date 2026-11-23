import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConvex } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { Group } from "@/components/parts";
import { cn } from "@/lib/utils";
import { INDEX } from "../../../convex/stonks/market";
import type { Dir } from "./Chart";
import { moveInk } from "./colors";
import { percent, price, signed } from "./format";
import { S } from "./skeletons";
import { Ticker } from "./Ticker";
import { report, warmStock } from "./warm";

export const ink = (d: Dir) => `var(--${d})`;

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

export function Change({
  change,
  base,
  unit,
  small,
  label,
  instant,
}: {
  change: number;
  base: number;
  unit?: string;
  small?: boolean;
  label?: string;
  instant?: boolean;
}) {
  const dir: Dir = change < 0 ? "down" : "up";
  const Icon = dir === "up" ? CaretUpIcon : CaretDownIcon;
  const pct = (change / base) * 100;
  const text = small ? `${change < 0 ? "−" : "+"}${percent(pct)}` : `${signed(change, unit)} (${percent(pct)})`;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap font-semibold", small ? "text-footnote" : "text-callout")}>
      <Icon weight="fill" className="shrink-0" style={{ color: moveInk((dir === "up" ? 1 : -1) * Math.abs(pct / 100)) }} aria-label={dir} />
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

export function RangeRow({
  label,
  low,
  high,
  value,
  unit,
  mark,
}: {
  label: string;
  low?: number;
  high?: number;
  value?: number;
  unit: string;
  mark?: { at: number; name: string };
}) {
  const known = low !== undefined && high !== undefined && high > low;
  const at = (x: number) => `${Math.max(0, Math.min(1, (x - low!) / (high! - low!))) * 100}%`;
  return (
    <div
      className={`${S.range} flex flex-col justify-center gap-2.5 px-4`}
      aria-label={known ? `${label}: ${price(low, unit)} to ${price(high, unit)}` : label}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-callout text-muted-foreground">{label}</span>
        <span className="text-callout font-semibold tabular-nums">{known ? `${price(low, unit)} – ${price(high, unit)}` : "—"}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted" aria-hidden>
        {known && mark && (
          <span
            className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-muted-foreground"
            style={{ left: at(mark.at) }}
            title={mark.name}
          />
        )}
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
