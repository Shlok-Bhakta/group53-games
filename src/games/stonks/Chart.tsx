import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Point } from "../../../convex/stonks/board";
import { cn } from "@/lib/utils";

export type Dir = "up" | "down";
const ink = (dir: Dir) => `var(--${dir})`;

// One price line, drawn to the app's chart marks: a 2px line in the up or down color, a faint wash
// under it, a dotted line at the previous close, and a ringed dot at the latest price that pulses while
// the price is live. Put a finger on it and a hairline follows to the nearest point; the owner shows
// that point's price where the live one was (`onScrub`), the way stock apps do.
//
// On the 1D chart the x axis is the clock from 4am to 8pm New York, so the line grows through the day,
// and anything outside the regular session (`regular`) is drawn lighter. Longer ranges space their
// points evenly, so nights and weekends don't leave gaps.
export function PriceChart({
  points,
  baseline,
  domain,
  regular,
  dir,
  live,
  height = 200,
  label,
  timeLabel,
  onScrub,
  stale,
  surface = "var(--background)",
}: {
  points: Point[];
  baseline?: number;
  domain?: [number, number];
  regular?: [number, number];
  dir: Dir;
  live?: boolean;
  height?: number;
  label: string;
  timeLabel: (t: number) => string;
  onScrub?: (p: Point | null) => void;
  stale?: boolean;
  surface?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [at, setAt] = useState<number | null>(null);
  const still = useReducedMotion();
  const gradient = useId();

  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const TOP = 24, BOTTOM = 10, LEFT = 2, RIGHT = 8; // room for the time label and the end dot
  const geo = useMemo(() => {
    if (!width || points.length === 0) return null;
    const w = width - LEFT - RIGHT, h = height - TOP - BOTTOM;
    const prices = points.map((p) => p[1]);
    let lo = Math.min(...prices, baseline ?? Infinity), hi = Math.max(...prices, baseline ?? -Infinity);
    const padY = (hi - lo || hi * 0.01 || 1) * 0.08;
    lo -= padY;
    hi += padY;
    const n = points.length;
    const xs = points.map((p, i) => LEFT + w * (domain ? (p[0] - domain[0]) / (domain[1] - domain[0]) : n === 1 ? 1 : i / (n - 1)));
    const y = (v: number) => TOP + h * (1 - (v - lo) / (hi - lo));
    const ys = prices.map(y);
    // Runs of points inside or outside the regular session, each starting where the last one ended.
    const runs: { from: number; to: number; dim: boolean }[] = [];
    points.forEach((p, i) => {
      const dim = !!regular && (p[0] < regular[0] || p[0] >= regular[1]);
      const last = runs.at(-1);
      if (last && last.dim === dim) last.to = i;
      else runs.push({ from: Math.max(0, i - 1), to: i, dim });
    });
    const path = (from: number, to: number) => xs.slice(from, to + 1).map((x, k) => `${k ? "L" : "M"}${x.toFixed(1)},${ys[from + k].toFixed(1)}`).join("");
    const line = path(0, n - 1);
    const area = `${line}L${xs[n - 1].toFixed(1)},${height}L${xs[0].toFixed(1)},${height}Z`;
    return { xs, ys, runs, path, area, base: baseline === undefined ? null : y(baseline), y };
  }, [width, height, points, baseline, domain, regular]);

  const pick = (clientX: number) => {
    if (!geo || !box.current) return;
    const x = clientX - box.current.getBoundingClientRect().left;
    let lo = 0, hi = geo.xs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (geo.xs[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    const i = lo > 0 && Math.abs(geo.xs[lo - 1] - x) < Math.abs(geo.xs[lo] - x) ? lo - 1 : lo;
    if (i !== at) {
      setAt(i);
      onScrub?.(points[i]);
    }
  };
  const stop = () => {
    setAt(null);
    onScrub?.(null);
  };
  const keys = (e: KeyboardEvent) => {
    if (!points.length) return;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (e.key === "Escape") return stop();
    if (!step) return;
    e.preventDefault();
    const i = Math.max(0, Math.min(points.length - 1, (at ?? points.length - 1) + step));
    setAt(i);
    onScrub?.(points[i]);
  };

  const end = geo && points.length ? { x: geo.xs[points.length - 1], y: geo.ys[points.length - 1] } : null;
  const scrub = geo && at !== null && at < points.length ? { x: geo.xs[at], y: geo.ys[at], t: points[at][0] } : null;

  return (
    <div
      ref={box}
      role="img"
      aria-label={label}
      tabIndex={0}
      className={cn("relative w-full touch-pan-y select-none outline-none transition-opacity focus-visible:ring-3 focus-visible:ring-ring/50", stale && "opacity-50")}
      style={{ height }}
      onPointerDown={(e: PointerEvent) => {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        pick(e.clientX);
      }}
      onPointerMove={(e: PointerEvent) => (e.pointerType === "mouse" || e.buttons ? pick(e.clientX) : undefined)}
      onPointerUp={(e) => e.pointerType !== "mouse" && stop()}
      onPointerCancel={stop}
      onPointerLeave={(e) => e.pointerType === "mouse" && stop()}
      onKeyDown={keys}
      onBlur={stop}
      data-scrubbing={scrub ? "" : undefined}
    >
      {geo && (
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={ink(dir)} stopOpacity={0.16} />
              <stop offset="100%" stopColor={ink(dir)} stopOpacity={0} />
            </linearGradient>
          </defs>
          {geo.base !== null && <line x1={LEFT} x2={width - RIGHT} y1={geo.base} y2={geo.base} stroke="var(--muted-foreground)" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="1 4" strokeLinecap="round" />}
          <path d={geo.area} fill={`url(#${gradient})`} />
          {geo.runs.map((r, k) => (
            <path key={k} d={geo.path(r.from, r.to)} fill="none" stroke={ink(dir)} strokeOpacity={r.dim ? 0.45 : 1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {scrub && <line x1={scrub.x} x2={scrub.x} y1={TOP - 4} y2={height} stroke="var(--muted-foreground)" strokeOpacity={0.6} strokeWidth={1} />}
          {end && !scrub && live && !still && (
            <motion.circle
              cx={end.x}
              cy={end.y}
              fill={ink(dir)}
              initial={{ r: 4, opacity: 0.45 }}
              animate={{ r: 13, opacity: 0 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          {(scrub ?? end) && <circle cx={(scrub ?? end)!.x} cy={(scrub ?? end)!.y} r={4.5} fill={ink(dir)} stroke={surface} strokeWidth={2} />}
        </svg>
      )}
      {scrub && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap text-caption font-medium text-muted-foreground tabular-nums"
          style={{ left: Math.max(44, Math.min(width - 44, scrub.x)) }}
        >
          {timeLabel(scrub.t)}
        </div>
      )}
    </div>
  );
}

// The board's little chart: the day so far against the previous close, nothing to touch.
export function Sparkline({ points, baseline, domain, dir, width = 64, height = 30 }: { points: Point[]; baseline?: number; domain?: [number, number]; dir: Dir; width?: number; height?: number }) {
  if (points.length < 2) return <span style={{ width, height }} className="block shrink-0" aria-hidden />;
  const prices = points.map((p) => p[1]);
  let lo = Math.min(...prices, baseline ?? Infinity), hi = Math.max(...prices, baseline ?? -Infinity);
  const pad = (hi - lo || 1) * 0.1;
  lo -= pad;
  hi += pad;
  const x = (p: Point, i: number) => 1.5 + (width - 3) * (domain ? Math.min(1, (p[0] - domain[0]) / (domain[1] - domain[0])) : i / (points.length - 1));
  const y = (v: number) => 1.5 + (height - 3) * (1 - (v - lo) / (hi - lo));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p, i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible" aria-hidden>
      {baseline !== undefined && <line x1={0} x2={width} y1={y(baseline)} y2={y(baseline)} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="1 3" strokeLinecap="round" />}
      <path d={d} fill="none" stroke={ink(dir)} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
