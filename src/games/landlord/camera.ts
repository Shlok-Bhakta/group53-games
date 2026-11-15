import { useCallback, useRef, useState, type RefObject } from "react";
import { animate, useMotionValue, useReducedMotion } from "motion/react";
import { SIDE } from "./geometry";

const MAX_ZOOM = 1.8;
export const CLOSE = 1.05;
const SPRING = { type: "spring", stiffness: 170, damping: 28, mass: 1 } as const;
const DRAG_SLOP = 8;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const MIN_OPEN = 120;
const FIT_MARGIN = 0.96;
const EDGE_ROOM = 0.4;

export type CameraView = { w: number; h: number; top: number; bottom: number; left: number; right: number };
export const UNMEASURED_VIEW: CameraView = { w: 390, h: 844, top: 110, bottom: 220, left: 0, right: 0 };

export type Camera = ReturnType<typeof useCamera>;

export function useCamera(viewport: RefObject<HTMLDivElement | null>, view: CameraView) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const k = useMotionValue(0.45);
  const reduce = useReducedMotion();
  const manual = useRef(false);
  const [overview, setOverview] = useState(true);

  const openW = Math.max(MIN_OPEN, view.w - view.left - view.right);
  const openH = Math.max(MIN_OPEN, view.h - view.top - view.bottom);
  const fit = Math.min(openW / SIDE, openH / SIDE) * FIT_MARGIN;
  const isOverview = (kk: number) => kk <= fit * 1.02;
  const clampK = useCallback((v: number) => Math.min(MAX_ZOOM, Math.max(fit, v)), [fit]);
  const clampXY = useCallback(
    (nx: number, ny: number, kk: number) => {
      const span = SIDE * kk;
      const room = Math.min(openW, openH) * EDGE_ROOM;
      const cx = view.left + (openW - span) / 2;
      const cy = view.top + (openH - span) / 2;
      const ox = span < openW ? cx : Math.min(view.left + room, Math.max(view.left + openW - span - room, nx));
      const oy = span < openH ? cy : Math.min(view.top + room, Math.max(view.top + openH - span - room, ny));
      return { x: ox, y: oy };
    },
    [openW, openH, view.left, view.top],
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

  const focus = useCallback(
    (wx: number, wy: number, scale = CLOSE, opts: { instant?: boolean; force?: boolean } = {}) => {
      if (manual.current && !opts.force) return;
      const kk = clampK(scale);
      setOverview(kk <= fit * 1.02);
      go(view.left + openW / 2 - wx * kk, view.top + openH / 2 - wy * kk, kk, opts.instant);
    },
    [clampK, fit, go, view.left, view.top, openW, openH],
  );
  const whole = useCallback(
    (instant = false) => {
      setOverview(true);
      go(0, 0, fit, instant);
    },
    [fit, go],
  );
  const release = useCallback(() => {
    manual.current = false;
  }, []);
  const hold = useCallback(() => {
    manual.current = true;
  }, []);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const origin = () => {
    const rect = viewport.current?.getBoundingClientRect();
    return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
  };
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
      if (moved.current > DRAG_SLOP) {
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
      const { left: ox, top: oy } = origin();
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
      setOverview(isOverview(k1));
    }
    ps.set(e.pointerId, next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const ps = pointers.current;
    ps.delete(e.pointerId);
    if (ps.size > 0 || moved.current > DRAG_SLOP) return;
    const now = performance.now();
    const t = lastTap.current;
    const doubleTap = now - t.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - t.x, e.clientY - t.y) < DOUBLE_TAP_PX;
    if (!doubleTap) {
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      return;
    }
    lastTap.current = { t: 0, x: 0, y: 0 };
    manual.current = true;
    if (!overview) return whole();
    const { left, top } = origin();
    focus((e.clientX - left - x.get()) / k.get(), (e.clientY - top - y.get()) / k.get(), CLOSE, { force: true });
  };
  const onWheel = (e: React.WheelEvent) => {
    manual.current = true;
    const kk = clampK(k.get() * (e.ctrlKey ? Math.exp(-e.deltaY / 200) : 1));
    const { left, top } = origin();
    const px = e.clientX - left;
    const py = e.clientY - top;
    const nx = e.ctrlKey ? px - (px - x.get()) * (kk / k.get()) : x.get() - e.deltaX;
    const ny = e.ctrlKey ? py - (py - y.get()) * (kk / k.get()) : y.get() - e.deltaY;
    const c = clampXY(nx, ny, kk);
    k.set(kk);
    x.set(c.x);
    y.set(c.y);
    setOverview(isOverview(kk));
  };
  const swallowTapAfterDrag = (e: React.MouseEvent) => {
    if (moved.current > DRAG_SLOP) {
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
    hold,
    overview,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onWheel, onClickCapture: swallowTapAfterDrag },
  };
}
