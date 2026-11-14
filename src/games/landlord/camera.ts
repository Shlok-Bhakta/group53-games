import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { animate, useMotionValue, useReducedMotion } from "motion/react";
import { SIDE } from "./geometry";

// The camera over the board: where it's looking and how close, as motion values the board's transform reads
// straight from (nothing re-renders as it moves). The game points it at whatever's happening; a finger drags
// it, two pinch it, a double tap flips between the whole board and close up. Moving it by hand holds it there
// until the game next has something to show (`manual`).

const MAX_ZOOM = 1.8;
// How close the game looks at what's happening: squares big enough to read their names.
export const CLOSE = 1.05;
const SPRING = { type: "spring", stiffness: 170, damping: 28, mass: 1 } as const;

export type Camera = ReturnType<typeof useCamera>;

export function useCamera(viewport: RefObject<HTMLDivElement | null>, pads: { top: number; bottom: number }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const k = useMotionValue(0.45);
  const reduce = useReducedMotion();
  const [size, setSize] = useState({ w: 390, h: 844 });
  const manual = useRef(false);
  const [overview, setOverview] = useState(true);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [viewport]);

  const open = Math.max(120, size.h - pads.top - pads.bottom);
  const fit = Math.min(size.w / SIDE, open / SIDE) * 0.96;
  const clampK = useCallback((v: number) => Math.min(MAX_ZOOM, Math.max(fit, v)), [fit]);
  // Keeps the board on screen: centered when it's smaller than the open part, otherwise no more than a little
  // way off any edge.
  const clampXY = useCallback(
    (nx: number, ny: number, kk: number) => {
      const span = SIDE * kk;
      // Room past the board's edge, so a square on the edge can sit in the middle of the open part.
      const m = Math.min(size.w, open) * 0.4;
      const cx = (size.w - span) / 2;
      const cy = pads.top + (open - span) / 2;
      const ox = span < size.w ? cx : Math.min(m, Math.max(size.w - span - m, nx));
      const oy = span < open ? cy : Math.min(pads.top + m, Math.max(pads.top + open - span - m, ny));
      return { x: ox, y: oy };
    },
    [size.w, open, pads.top],
  );

  const go = useCallback(
    (nx: number, ny: number, kk: number, instant = false) => {
      const c = clampXY(nx, ny, kk);
      if (instant || reduce) {
        x.set(c.x);
        y.set(c.y);
        k.set(kk);
        return;
      }
      void animate(x, c.x, SPRING);
      void animate(y, c.y, SPRING);
      void animate(k, kk, SPRING);
    },
    [clampXY, reduce, x, y, k],
  );

  // Looks at a point of the board, in the middle of the open part of the screen.
  const focus = useCallback(
    (wx: number, wy: number, scale = CLOSE, opts: { instant?: boolean; force?: boolean } = {}) => {
      if (manual.current && !opts.force) return;
      const kk = clampK(scale);
      setOverview(kk <= fit * 1.02);
      go(size.w / 2 - wx * kk, pads.top + open / 2 - wy * kk, kk, opts.instant);
    },
    [clampK, fit, go, size.w, pads.top, open],
  );
  const whole = useCallback(
    (instant = false) => {
      setOverview(true);
      go(0, 0, fit, instant);
    },
    [fit, go],
  );
  // The game has something new to show: hand the camera back.
  const release = useCallback(() => {
    manual.current = false;
  }, []);

  // Fingers.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) moved.current = 0;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    if (ps.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      moved.current += Math.abs(dx) + Math.abs(dy);
      if (moved.current > 8) {
        manual.current = true;
        const c = clampXY(x.get() + dx, y.get() + dy, k.get());
        x.stop();
        y.stop();
        x.set(c.x);
        y.set(c.y);
      }
    } else if (ps.size === 2) {
      const [a, b] = [...ps.entries()].map(([id, p]) => (id === e.pointerId ? next : p));
      const [a0, b0] = [...ps.values()];
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
      const d1 = Math.hypot(a.x - b.x, a.y - b.y);
      const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = viewport.current?.getBoundingClientRect();
      const ox = rect?.left ?? 0;
      const oy = rect?.top ?? 0;
      const k0 = k.get();
      const k1 = clampK(k0 * (d0 > 0 ? d1 / d0 : 1));
      const nx = mid.x - ox - (mid0.x - ox - x.get()) * (k1 / k0);
      const ny = mid.y - oy - (mid0.y - oy - y.get()) * (k1 / k0);
      const c = clampXY(nx, ny, k1);
      manual.current = true;
      moved.current += 100;
      x.stop();
      y.stop();
      k.stop();
      k.set(k1);
      x.set(c.x);
      y.set(c.y);
      setOverview(k1 <= fit * 1.02);
    }
    ps.set(e.pointerId, next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const ps = pointers.current;
    ps.delete(e.pointerId);
    if (ps.size > 0 || moved.current > 8) return;
    // A double tap: the whole board, or close up where it landed.
    const now = performance.now();
    const t = lastTap.current;
    if (now - t.t < 300 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 30) {
      lastTap.current = { t: 0, x: 0, y: 0 };
      manual.current = true;
      if (!overview) whole();
      else {
        const rect = viewport.current?.getBoundingClientRect();
        const wx = (e.clientX - (rect?.left ?? 0) - x.get()) / k.get();
        const wy = (e.clientY - (rect?.top ?? 0) - y.get()) / k.get();
        focus(wx, wy, CLOSE, { force: true });
      }
    } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
  };
  const onWheel = (e: React.WheelEvent) => {
    manual.current = true;
    const kk = clampK(k.get() * (e.ctrlKey ? Math.exp(-e.deltaY / 200) : 1));
    const rect = viewport.current?.getBoundingClientRect();
    const px = e.clientX - (rect?.left ?? 0);
    const py = e.clientY - (rect?.top ?? 0);
    const nx = e.ctrlKey ? px - (px - x.get()) * (kk / k.get()) : x.get() - e.deltaX;
    const ny = e.ctrlKey ? py - (py - y.get()) * (kk / k.get()) : y.get() - e.deltaY;
    const c = clampXY(nx, ny, kk);
    k.set(kk);
    x.set(c.x);
    y.set(c.y);
    setOverview(kk <= fit * 1.02);
  };
  // A drag that ends over a square isn't a tap on it.
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current > 8) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return {
    x,
    y,
    k,
    focus,
    whole,
    release,
    overview,
    manual,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onWheel, onClickCapture },
  };
}
