import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConvex } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Dir } from "./Chart";
import { percent, signed } from "./format";
import { Ticker } from "./Ticker";
import { warmStock } from "./warm";

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
