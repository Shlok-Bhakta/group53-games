import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, animate, motion } from "motion/react";
import { layout, type Placed } from "../../../convex/scrabble/engine";
import { cn } from "@/lib/utils";
import { LetterTile, PREMIUM_STYLE } from "./Tile";

export type DraftTile = { id: number; x: number; y: number; letter: string; blank: boolean };
export type BoardHandle = {
  // The square under a point on screen, if it's on the board and inside the visible part of it.
  cellAt: (clientX: number, clientY: number) => [number, number] | null;
};
type Props = {
  size: number;
  // The board's side on screen at its smallest, in px, and the window it's seen through (which can be
  // taller than the board, so it fills the screen and you pan around it).
  px: number;
  view?: { width: number; height: number; padTop?: number };
  tiles: Placed[];
  draft: DraftTile[];
  seatColor: (seat: number) => string;
  // Squares from the latest move, which pop in and stay outlined in their player's color.
  fresh: Set<string>;
  freshSeat: number | null;
  // Where a dragged tile would land.
  target: [number, number] | null;
  // How the tiles I've laid out read: still checking, all real words, or not.
  tone: "idle" | "ok" | "bad";
  // The score of what I've laid out, by the end of the main word.
  bubble: { x: number; y: number; text: string } | null;
  // A draft tile that's being dragged, so it isn't drawn twice.
  hidden: number | null;
  // Where to look first: the middle of what's on the board, or the centre star.
  focus: [number, number];
  zoomOnDoubleTap: boolean;
  // Squares to bring into view when `key` changes: a word someone just played.
  reveal?: { key: number; cells: [number, number][] };
  // Where whoever's turn it is has laid tiles out, face down, in their color.
  ghosts: { cells: [number, number][]; color: string } | null;
  // The latest play's score, floating up off its last tile.
  scored: { key: number; x: number; y: number; text: string; color: string } | null;
  // Bumped to shake my tiles when they don't make real words.
  shake: number;
  onCellTap: (x: number, y: number) => void;
  onDraftDown: (id: number, e: ReactPointerEvent) => void;
};

const MAX_CELL = 52;
const START_CELL = 38;
const key = (x: number, y: number) => `${x},${y}`;

// The board: pinch or double-tap to zoom, drag to look around. Moves happen in the DOM directly, not
// through React, so panning stays smooth on a full board.
export const ScrabbleBoard = forwardRef<BoardHandle, Props>(function ScrabbleBoard(props, ref) {
  const { size, px, view, tiles, draft, seatColor, fresh, freshSeat, target, tone, bubble, hidden, focus, zoomOnDoubleTap, reveal, ghosts, scored, shake, onCellTap, onDraftDown } = props;
  // Fresh tiles land in reading order, one after another, in time with the notes of the play sound.
  const freshOrder = useMemo(() => new Map([...fresh].sort((a, b) => a.split(",").map(Number).reduce((s, v) => s + v, 0) - b.split(",").map(Number).reduce((s, v) => s + v, 0)).map((k, i) => [k, i])), [fresh]);
  const base = px / size;
  const maxScale = Math.max(1, MAX_CELL / base);
  const startScale = Math.min(maxScale, Math.max(1, START_CELL / base));
  const viewport = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const t = useRef({ s: 1, tx: 0, ty: 0 });

  const vw = view?.width ?? px;
  const vh = view?.height ?? px;
  const padTop = view?.padTop ?? 0;
  // Keeps the board in view: smaller than the window, it sits in the middle; bigger, its edges can't be
  // dragged past the window's (the top can come down far enough to clear anything floating over it).
  const clamp = useCallback(
    (s: number, tx: number, ty: number) => {
      const sc = Math.min(maxScale, Math.max(1, s));
      const side = px * sc;
      const axis = (v: number, dim: number, pad = 0) => (side + pad <= dim ? pad + (dim - pad - side) / 2 : Math.min(pad, Math.max(dim - side, v)));
      return { s: sc, tx: axis(tx, vw), ty: axis(ty, vh, padTop) };
    },
    [maxScale, px, vw, vh, padTop],
  );
  const apply = useCallback((next: { s: number; tx: number; ty: number }) => {
    t.current = next;
    const el = layer.current;
    if (!el) return;
    el.style.transform = `translate3d(${next.tx}px, ${next.ty}px, 0) scale(${next.s})`;
    el.style.setProperty("--s", String(next.s));
  }, []);
  const centredOn = useCallback((s: number, cx: number, cy: number) => clamp(s, vw / 2 - (cx + 0.5) * base * s, (vh + padTop) / 2 - (cy + 0.5) * base * s), [base, clamp, vw, vh, padTop]);

  // Start zoomed in on the action, once we know how big the board is.
  const started = useRef<string>("");
  useLayoutEffect(() => {
    const k = `${px}:${size}:${vw}:${vh}`;
    if (!px || started.current === k) return;
    started.current = k;
    apply(centredOn(startScale, focus[0], focus[1]));
  }, [px, size, startScale, focus, apply, centredOn]);

  const zoomTo = useCallback(
    (next: { s: number; tx: number; ty: number }) => {
      const from = { ...t.current };
      animate(0, 1, {
        type: "spring",
        bounce: 0,
        duration: 0.35,
        onUpdate: (p) => apply({ s: from.s + (next.s - from.s) * p, tx: from.tx + (next.tx - from.tx) * p, ty: from.ty + (next.ty - from.ty) * p }),
      });
    },
    [apply],
  );

  // --- Gestures: one finger pans (or taps), two pinch. ---
  const g = useRef({
    pts: new Map<number, { x: number; y: number }>(),
    mode: "none" as "none" | "maybe" | "pan" | "pinch",
    start: { s: 1, tx: 0, ty: 0 },
    origin: { x: 0, y: 0 },
    pinch: { dist: 1, lx: 0, ly: 0 },
    lastTap: { at: 0, x: 0, y: 0 },
  });

  // A new word landed out of view: glide over to it, unless a finger is on the board.
  const revealed = useRef(reveal?.key);
  useEffect(() => {
    if (!reveal || revealed.current === reveal.key || !px) return;
    revealed.current = reveal.key;
    if (g.current.mode !== "none" || !reveal.cells.length) return;
    const { s, tx, ty } = t.current;
    const seen = ([x, y]: [number, number]) => {
      const sx = tx + (x + 0.5) * base * s;
      const sy = ty + (y + 0.5) * base * s;
      return sx > 0 && sy > padTop && sx < vw && sy < vh;
    };
    if (reveal.cells.every(seen)) return;
    const cx = reveal.cells.reduce((a, [x]) => a + x, 0) / reveal.cells.length;
    const cy = reveal.cells.reduce((a, [, y]) => a + y, 0) / reveal.cells.length;
    zoomTo(centredOn(s, cx, cy));
  }, [reveal, px, base, zoomTo, centredOn, padTop, vw, vh]);

  const cellAt = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const el = viewport.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
      const { s, tx, ty } = t.current;
      const x = Math.floor((clientX - r.left - tx) / s / base);
      const y = Math.floor((clientY - r.top - ty) / s / base);
      return x >= 0 && y >= 0 && x < size && y < size ? [x, y] : null;
    },
    [base, size],
  );
  useImperativeHandle(ref, () => ({ cellAt }), [cellAt]);

  const restart = () => {
    const st = g.current;
    st.start = { ...t.current };
    const pts = [...st.pts.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      const r = viewport.current!.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      st.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, lx: (mx - st.start.tx) / st.start.s, ly: (my - st.start.ty) / st.start.s };
      st.mode = "pinch";
    } else if (pts.length === 1) {
      st.origin = { ...pts[0] };
    }
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = g.current;
    const draftEl = (e.target as Element).closest?.("[data-draft]");
    if (draftEl && st.pts.size === 0) {
      onDraftDown(Number(draftEl.getAttribute("data-draft")), e);
      return;
    }
    viewport.current?.setPointerCapture(e.pointerId);
    st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pts.size === 1) st.mode = "maybe";
    restart();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = g.current;
    if (!st.pts.has(e.pointerId)) return;
    st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.mode === "maybe" && Math.hypot(e.clientX - st.origin.x, e.clientY - st.origin.y) > 8) st.mode = "pan";
    if (st.mode === "pan") {
      apply(clamp(st.start.s, st.start.tx + e.clientX - st.origin.x, st.start.ty + e.clientY - st.origin.y));
    } else if (st.mode === "pinch") {
      const [a, b] = [...st.pts.values()];
      const r = viewport.current!.getBoundingClientRect();
      const s = Math.min(maxScale, Math.max(1, (st.start.s * Math.hypot(a.x - b.x, a.y - b.y)) / st.pinch.dist));
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      apply(clamp(s, mx - st.pinch.lx * s, my - st.pinch.ly * s));
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = g.current;
    if (!st.pts.has(e.pointerId)) return;
    const wasTap = st.mode === "maybe" && st.pts.size === 1;
    st.pts.delete(e.pointerId);
    if (wasTap && e.type === "pointerup") {
      const cell = cellAt(e.clientX, e.clientY);
      const now = performance.now();
      const double = now - st.lastTap.at < 320 && Math.hypot(e.clientX - st.lastTap.x, e.clientY - st.lastTap.y) < 30;
      st.lastTap = { at: double ? 0 : now, x: e.clientX, y: e.clientY };
      if (double && zoomOnDoubleTap && cell) {
        zoomTo(t.current.s > 1.05 ? clamp(1, 0, 0) : centredOn(startScale, cell[0], cell[1]));
      } else if (cell) onCellTap(cell[0], cell[1]);
    }
    if (st.pts.size === 0) st.mode = "none";
    else {
      st.mode = st.mode === "pinch" ? "pan" : st.mode;
      restart();
      if (st.pts.size === 1) st.mode = "pan";
    }
  };
  // Trackpads and mouse wheels, for desktop.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const { s, tx, ty } = t.current;
      if (e.ctrlKey || e.metaKey || !e.deltaX) {
        const next = Math.min(maxScale, Math.max(1, s * Math.exp(-e.deltaY * 0.004)));
        const lx = (e.clientX - r.left - tx) / s;
        const ly = (e.clientY - r.top - ty) / s;
        apply(clamp(next, e.clientX - r.left - lx * next, e.clientY - r.top - ly * next));
      } else apply(clamp(s, tx - e.deltaX, ty - e.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply, clamp, maxScale]);

  const ring = tone === "ok" ? "var(--tile-green)" : tone === "bad" ? "var(--tile-hit)" : "var(--primary)";

  return (
    <div
      ref={viewport}
      data-board
      role="group"
      aria-label="Board"
      className={cn("relative touch-none overflow-hidden select-none", !view && "rounded-sm")}
      style={{ width: vw, height: vh }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={layer} className="absolute left-0 top-0 origin-top-left rounded-[3px] bg-border" style={{ width: px, height: px }}>
        <Squares size={size} base={base} />
        {tiles.map((tile) => {
          const k = key(tile.x, tile.y);
          const isFresh = fresh.has(k);
          return (
            <motion.div
              key={k}
              data-cell={k}
              data-letter={tile.letter}
              className="absolute grid place-items-center rounded-[3px]"
              style={{ left: tile.x * base, top: tile.y * base, width: base, height: base, background: isFresh && freshSeat !== null ? `color-mix(in oklch, ${seatColor(freshSeat)} 55%, transparent)` : undefined }}
            >
              <motion.span
                className="grid place-items-center"
                initial={isFresh ? { y: -base * 0.8, scale: 0.6, opacity: 0 } : false}
                animate={isFresh ? { y: [-base * 0.8, 0, -base * 0.28, 0], scale: [0.6, 1.08, 1, 0.9], opacity: [0, 1, 1, 1] } : { y: 0, scale: 1, opacity: 1 }}
                transition={{ duration: 0.62, times: [0, 0.42, 0.7, 1], ease: "easeOut", delay: 0.07 * (freshOrder.get(k) ?? 0) }}
              >
                <LetterTile letter={tile.letter} blank={tile.blank} size={base - 2} seat={seatColor(tile.seat)} />
              </motion.span>
            </motion.div>
          );
        })}
        <AnimatePresence>
          {ghosts?.cells
            .filter(([x, y]) => !tiles.some((t) => t.x === x && t.y === y))
            .map(([x, y]) => (
              <motion.div
                key={`g${x},${y}`}
                data-ghost={key(x, y)}
                className="pointer-events-none absolute grid place-items-center"
                style={{ left: x * base, top: y * base, width: base, height: base }}
                initial={{ scale: 0.3, opacity: 0, rotate: -12 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.4, opacity: 0, rotate: 10 }}
                transition={{ type: "spring", bounce: 0.45, duration: 0.4 }}
              >
                {/* Face down: a solid tile back in the player's color, so nothing shows through. */}
                <LetterTile letter="?" size={base - 2} seat={ghosts.color} style={{ background: `linear-gradient(color-mix(in oklch, ${ghosts.color} 30%, #fbf0d6), color-mix(in oklch, ${ghosts.color} 42%, #efdcb4))` }} />
              </motion.div>
            ))}
        </AnimatePresence>
        <Puffs cells={ghosts?.cells ?? []} base={base} color={ghosts?.color ?? "var(--muted-foreground)"} />
        {draft.map((d) => (
          <motion.div
            key={`d${d.id}`}
            data-draft={d.id}
            data-cell={key(d.x, d.y)}
            data-letter={d.letter}
            className={cn("absolute grid touch-none place-items-center rounded-[4px]", d.id === hidden && "opacity-0")}
            style={{ width: base, height: base, boxShadow: `inset 0 0 0 2px ${ring}` }}
            initial={{ left: d.x * base, top: d.y * base, scale: 1.3 }}
            animate={{ left: d.x * base, top: d.y * base, scale: 1 }}
            transition={{ type: "spring", bounce: 0.5, duration: 0.3 }}
          >
            <motion.span
              key={tone === "bad" ? shake : 0}
              className="grid place-items-center"
              animate={tone === "bad" && shake ? { x: [0, -base * 0.12, base * 0.12, -base * 0.08, base * 0.06, 0] } : { x: 0 }}
              transition={{ duration: 0.38 }}
            >
              <LetterTile letter={d.letter} blank={d.blank} size={base - 4} />
            </motion.span>
          </motion.div>
        ))}
        {target && (
          <div
            className="pointer-events-none absolute rounded-[3px] ring-2 ring-primary ring-offset-0"
            style={{ left: target[0] * base, top: target[1] * base, width: base, height: base, background: "color-mix(in oklch, var(--primary) 25%, transparent)" }}
          />
        )}
        <AnimatePresence>
          {scored && (
            <motion.div
              key={scored.key}
              className="pointer-events-none absolute z-20"
              style={{ left: (scored.x + 0.5) * base, top: scored.y * base }}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: [0, 1, 1, 0], y: [0, -base * 0.9, -base * 1.3, -base * 1.8] }}
              transition={{ duration: 1.8, times: [0, 0.2, 0.7, 1], delay: 0.35 }}
            >
              <span className="block -translate-x-1/2 rounded-full px-2.5 py-1 font-display text-callout tabular-nums text-white shadow-lg" style={{ scale: "calc(1 / var(--s, 1))", background: scored.color }}>
                {scored.text}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        {bubble && (
          <motion.div
            key={`${bubble.x},${bubble.y}`}
            className="pointer-events-none absolute z-10"
            style={{ left: (bubble.x + 1) * base, top: bubble.y * base }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", bounce: 0.4, duration: 0.3 }}
          >
            <span
              className="block origin-bottom-left -translate-x-1/3 -translate-y-2/3 rounded-full px-2 py-0.5 text-footnote font-bold tabular-nums shadow"
              style={{ scale: "calc(1 / var(--s, 1))", background: ring, color: tone === "idle" ? "var(--primary-foreground)" : tone === "ok" ? "var(--tile-ink)" : "var(--tile-hit-ink)" }}
            >
              {bubble.text}
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
});

// Little puffs of smoke where face-down tiles appear or vanish.
function Puffs({ cells, base, color }: { cells: [number, number][]; base: number; color: string }) {
  const prev = useRef(new Set<string>());
  const [puffs, setPuffs] = useState<{ id: number; x: number; y: number }[]>([]);
  const nextId = useRef(0);
  const sig = cells.map(([x, y]) => key(x, y)).sort().join("|");
  useEffect(() => {
    const now = new Set(sig ? sig.split("|") : []);
    const changed = [...now].filter((k) => !prev.current.has(k)).concat([...prev.current].filter((k) => !now.has(k)));
    prev.current = now;
    if (!changed.length) return;
    const added = changed.map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { id: nextId.current++, x, y };
    });
    setPuffs((p) => [...p, ...added]);
    const ids = new Set(added.map((a) => a.id));
    const t = setTimeout(() => setPuffs((p) => p.filter((q) => !ids.has(q.id))), 700);
    return () => clearTimeout(t);
  }, [sig]);
  return (
    <>
      {puffs.map((p) => (
        <span key={p.id} className="pointer-events-none absolute z-10" style={{ left: (p.x + 0.5) * base, top: (p.y + 0.5) * base }}>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const a = (i / 6) * Math.PI * 2 + 0.4;
            return (
              <motion.span
                key={i}
                className="absolute -left-1 -top-1 size-2 rounded-full"
                style={{ background: color }}
                initial={{ x: 0, y: 0, opacity: 0.7, scale: 0.6 }}
                animate={{ x: Math.cos(a) * base * 0.75, y: Math.sin(a) * base * 0.75, opacity: 0, scale: 1.6 }}
                transition={{ duration: 0.55, ease: "easeOut" }}
              />
            );
          })}
        </span>
      ))}
    </>
  );
}

// The empty squares and their bonuses. Never changes during a game, so it's drawn once.
const Squares = memo(function Squares({ size, base }: { size: number; base: number }) {
  const rows = useMemo(() => layout(size), [size]);
  return (
    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, gridTemplateRows: `repeat(${size}, 1fr)` }}>
      {rows.flatMap((row, y) =>
        [...row].map((c, x) => {
          const p = PREMIUM_STYLE[c as keyof typeof PREMIUM_STYLE];
          return (
            <span
              key={`${x},${y}`}
              className="m-px grid place-items-center rounded-[2px] font-bold leading-none"
              style={{ background: p?.bg ?? "var(--muted)", color: p?.ink, fontSize: Math.max(7, base * 0.34) }}
            >
              {p?.label}
            </span>
          );
        }),
      )}
    </div>
  );
});
