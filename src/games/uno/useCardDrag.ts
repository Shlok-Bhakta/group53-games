import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Card } from "../../../convex/uno/cards";
import { sfx } from "@/sound";
import type { P } from "./fx";
import type { Pick } from "./Hand";

export type Aim = "ok" | "no" | null;

const SLOP = 8;
const SWALLOW_MS = 400;

export function useCardDrag({
  enabled,
  target,
  canPlay,
  onDrop,
}: {
  enabled: boolean;
  target: RefObject<HTMLElement | null>;
  canPlay: (card: Card) => boolean;
  onDrop: (card: Card, copy: number, at: P) => void;
}) {
  const ghost = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<Pick | null>(null);
  const [aim, setAim] = useState<Aim>(null);
  const endedAt = useRef(0);
  const latest = useRef({ canPlay, onDrop });
  useLayoutEffect(() => {
    latest.current = { canPlay, onDrop };
  });

  const inside = (x: number, y: number) => {
    const r = target.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const start = (card: Card, copy: number, e: ReactPointerEvent) => {
    if (!enabled || e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let over = false;
    let lastX = x0;
    let tilt = 0;
    const place = (cx: number, cy: number) => {
      tilt = Math.max(-14, Math.min(14, tilt * 0.6 + (cx - lastX) * 0.9));
      lastX = cx;
      if (ghost.current) ghost.current.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -60%) rotate(${tilt}deg)`;
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < SLOP) return;
      if (!moved) {
        moved = true;
        setHeld({ card, copy });
        sfx("pick");
        requestAnimationFrame(() => place(ev.clientX, ev.clientY));
      }
      place(ev.clientX, ev.clientY);
      const now = inside(ev.clientX, ev.clientY);
      if (now !== over) {
        over = now;
        setAim(now ? (latest.current.canPlay(card) ? "ok" : "no") : null);
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!moved) return;
      endedAt.current = performance.now();
      setHeld(null);
      setAim(null);
      if (ev.type === "pointercancel") return;
      if (over) latest.current.onDrop(card, copy, { x: ev.clientX, y: ev.clientY });
      else sfx("place");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const justDragged = () => performance.now() - endedAt.current < SWALLOW_MS;

  return { ghost, held, aim, start, justDragged };
}
