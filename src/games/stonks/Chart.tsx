import { memo, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Point } from "../../../convex/stonks/board";
import { cn } from "@/lib/utils";

export type Dir = "up" | "down";
const ink = (dir: Dir) => `var(--${dir})`;

// One price line, drawn to the app's chart marks: a 2px line in the up or down color, a faint wash
// under it, a dotted line at the previous close, and a ringed dot at the latest price. Put a finger on
// it and a hairline follows to the nearest point; the owner shows that point's price where the live one
// was (`onScrub`), the way stock apps do.
//
// It moves when something happens and never while idle: a new range draws in from the left (`reveal`
// changes), the live end of the line glides to each new trade, and each trade sends one ping out from
// the dot.
//
// On the 1D chart the x axis is the clock, so the line grows through the day, and anything outside the
// regular session (`regular`) is drawn lighter. Longer ranges space their points evenly, so nights and
// weekends don't leave gaps.
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
  reveal,
  surface = "var(--background)",
  overlays,
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
  reveal?: string;
  surface?: string;
  /** Extra lines on the same scale (moving averages), one value per point, null where there's none. */
  overlays?: { values: (number | null)[]; color: string; name: string }[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [at, setAt] = useState<number | null>(null);
  const still = useReducedMotion();
  const id = useId();

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
    let lo = Infinity, hi = -Infinity;
    for (const p of points) {
      if (p[1] < lo) lo = p[1];
      if (p[1] > hi) hi = p[1];
    }
    if (baseline !== undefined) {
      lo = Math.min(lo, baseline);
      hi = Math.max(hi, baseline);
    }
    for (const o of overlays ?? [])
      for (const x of o.values)
        if (x !== null) {
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
    const padY = (hi - lo || hi * 0.01 || 1) * 0.08;
    lo -= padY;
    hi += padY;
    const n = points.length;
    const xs = points.map((p, i) => LEFT + w * (domain ? (p[0] - domain[0]) / (domain[1] - domain[0]) : n === 1 ? 1 : i / (n - 1)));
    const y = (v: number) => TOP + h * (1 - (v - lo) / (hi - lo));
    const ys = points.map((p) => y(p[1]));
    const dim = (i: number) => !!regular && (points[i][0] < regular[0] || points[i][0] >= regular[1]);
    // Runs of points inside or outside the regular session, each starting where the last one ended. The
    // last point isn't in them: its segment is drawn on its own, so it can glide to each new trade.
    const runs: { from: number; to: number; dim: boolean }[] = [];
    for (let i = 0; i < n - 1; i++) {
      const last = runs.at(-1);
      if (last && last.dim === dim(i)) last.to = i;
      else runs.push({ from: Math.max(0, i - 1), to: i, dim: dim(i) });
    }
    const path = (from: number, to: number) => {
      let d = "";
      for (let i = from; i <= to; i++) d += `${i === from ? "M" : "L"}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`;
      return d;
    };
    const area = `${path(0, n - 1)}L${xs[n - 1].toFixed(1)},${height}L${xs[0].toFixed(1)},${height}Z`;
    const lines = (overlays ?? []).map((o) => {
      let d = "";
      let pen = false;
      o.values.forEach((x, i) => {
        if (x === null || i >= n) return void (pen = false);
        d += `${pen ? "L" : "M"}${xs[i].toFixed(1)},${y(x).toFixed(1)}`;
        pen = true;
      });
      return { d, color: o.color };
    });
    return { xs, ys, runs, path, area, lines, base: baseline === undefined ? null : y(baseline), lastDim: dim(n - 1) };
  }, [width, height, points, baseline, domain, regular, overlays]);

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

  const n = points.length;
  const end = geo && n ? { x: geo.xs[n - 1], y: geo.ys[n - 1] } : null;
  const prev = geo && n > 1 ? { x: geo.xs[n - 2], y: geo.ys[n - 2] } : end;
  const scrub = geo && at !== null && at < n ? { x: geo.xs[at], y: geo.ys[at], t: points[at][0] } : null;
  const glide = still ? { duration: 0 } : { type: "spring" as const, bounce: 0, duration: 0.45 };
  const trade = n ? `${points[n - 1][0]}:${points[n - 1][1]}` : "";

  return (
    <div
      ref={box}
      role="img"
      aria-label={label}
      tabIndex={0}
      className={cn("relative w-full touch-pan-y select-none outline-none transition-opacity duration-200 focus-visible:ring-3 focus-visible:ring-ring/50", stale && "opacity-50")}
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
      {geo && end && prev && (
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={`${id}g`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={ink(dir)} stopOpacity={0.16} />
              <stop offset="100%" stopColor={ink(dir)} stopOpacity={0} />
            </linearGradient>
            {/* A new range or stock draws in from the left. */}
            <clipPath id={`${id}c`}>
              <motion.rect key={reveal} x={-12} y={-12} height={height + 24} initial={{ width: still ? width + 24 : 0 }} animate={{ width: width + 24 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
            </clipPath>
          </defs>
          {geo.base !== null && <line x1={LEFT} x2={width - RIGHT} y1={geo.base} y2={geo.base} stroke="var(--muted-foreground)" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="1 4" strokeLinecap="round" />}
          <g clipPath={`url(#${id}c)`}>
            <path d={geo.area} fill={`url(#${id}g)`} />
            {geo.lines.map((l, k) => (
              <path key={`o${k}`} d={l.d} fill="none" stroke={l.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {geo.runs.map((r, k) => (
              <path key={k} d={geo.path(r.from, r.to)} fill="none" stroke={ink(dir)} strokeOpacity={r.dim ? 0.45 : 1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            <motion.line
              x1={prev.x}
              y1={prev.y}
              initial={false}
              animate={{ x2: end.x, y2: end.y }}
              transition={glide}
              stroke={ink(dir)}
              strokeOpacity={geo.lastDim ? 0.45 : 1}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </g>
          {scrub && <line x1={scrub.x} x2={scrub.x} y1={TOP - 4} y2={height} stroke="var(--muted-foreground)" strokeOpacity={0.6} strokeWidth={1} />}
          {/* One ping per trade while the price is live: an event, not a loop. */}
          <AnimatePresence>
            {live && !scrub && !still && (
              <motion.circle
                key={trade}
                cx={end.x}
                cy={end.y}
                fill={ink(dir)}
                initial={{ r: 4.5, opacity: 0.5 }}
                animate={{ r: 16, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.9, ease: "easeOut" }}
              />
            )}
          </AnimatePresence>
          {scrub ? (
            <circle cx={scrub.x} cy={scrub.y} r={4.5} fill={ink(dir)} stroke={surface} strokeWidth={2} />
          ) : (
            <motion.circle initial={false} animate={{ cx: end.x, cy: end.y }} transition={glide} r={4.5} fill={ink(dir)} stroke={surface} strokeWidth={2} />
          )}
        </svg>
      )}
      {/* Two or more lines get a key: drawn as short strokes, names in text color. */}
      {!scrub && overlays && overlays.length > 0 && (
        <div className="pointer-events-none absolute top-0 left-1 flex gap-3 text-caption font-medium text-muted-foreground">
          <Key color={ink(dir)} name="Price" />
          {overlays.map((o) => (
            <Key key={o.name} color={o.color} name={o.name} />
          ))}
        </div>
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

function Key({ color, name }: { color: string; name: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

/** A simple moving average over the last `n` values, null until there are `n`. */
export function movingAverage(values: number[], n: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n];
    return i >= n - 1 ? sum / n : null;
  });
}

// The board's little chart: the day so far against the previous close, nothing to touch.
export const Sparkline = memo(function Sparkline({ points, baseline, domain, dir, width = 64, height = 30 }: { points: Point[]; baseline?: number; domain?: [number, number]; dir: Dir; width?: number; height?: number }) {
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
});
