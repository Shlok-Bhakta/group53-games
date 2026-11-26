import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Card } from "../../../convex/uno/cards";
import { sfx } from "@/sound";
import type { P } from "./fx";
import type { Pick } from "./Hand";

export type Aim = "ok" | "no" | null;

const SLOP = 8;

export function useCardDrag({
  enabled,
  target,
  onDrop,
}: {
  enabled: boolean;
  target: RefObject<HTMLElement | null>;
  onDrop: (card: Card, copy: number, at: P) => void;
}) {
  const ghost = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<Pick | null>(null);
  const [over, setOver] = useState(false);
  const swallow = useRef(false);
  const latest = useRef(onDrop);
  useLayoutEffect(() => {
    latest.current = onDrop;
  });

  const inside = (x: number, y: number) => {
    const r = target.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const start = (card: Card, copy: number, e: ReactPointerEvent) => {
    swallow.current = false;
    if (!enabled || e.button !== 0) return;
    const id = e.pointerId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let lastX = x0;
    let tilt = 0;
    const place = (cx: number, cy: number) => {
      tilt = Math.max(-14, Math.min(14, tilt * 0.6 + (cx - lastX) * 0.9));
      lastX = cx;
      if (ghost.current) ghost.current.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -60%) rotate(${tilt}deg)`;
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < SLOP) return;
      if (!moved) {
        moved = true;
        setHeld({ card, copy });
        sfx("pick");
        requestAnimationFrame(() => place(ev.clientX, ev.clientY));
      }
      place(ev.clientX, ev.clientY);
      setOver(inside(ev.clientX, ev.clientY));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!moved) return;
      swallow.current = true;
      setHeld(null);
      setOver(false);
      if (ev.type === "pointercancel") return;
      if (inside(ev.clientX, ev.clientY)) latest.current(card, copy, { x: ev.clientX, y: ev.clientY });
      else sfx("place");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const justDragged = () => {
    const was = swallow.current;
    swallow.current = false;
    return was;
  };

  return { ghost, held, over: held !== null && over, start, justDragged };
}
