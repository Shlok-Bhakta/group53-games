import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { animate, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { chips } from "../format";
import { PACE } from "../show";

// What everything on the table moves with: a spring that overshoots a little, a flight that lands softly, and
// the deck's card width, which a card flying from or to the deck scales to.
export const SPRING = [0.34, 1.45, 0.64, 1] as const;
export const FLIGHT = [0.2, 0.85, 0.25, 1] as const;
export const DECK_W = 28;

// How far something has to travel to reach the deck, the pile or a seat, from where it sits on the table.
export function toward(el: HTMLElement, selector: string) {
  const there = el.closest("[data-table]")?.querySelector(selector)?.getBoundingClientRect();
  const here = el.getBoundingClientRect();
  if (!there) return null;
  return { x: there.left + there.width / 2 - (here.left + here.width / 2), y: there.top + there.height / 2 - (here.top + here.height / 2) };
}

// A card dealt to where it belongs. It's the real card from the first frame, in its final place, and flies
// there from the deck, so there's nothing to swap at the end of the flight. The rotation of a fan belongs to
// whatever's inside.
export function Flying({ width, fly, spin = -14, className, children }: { width: number; fly: boolean; spin?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
  useLayoutEffect(() => {
    if (!fly || still || !ref.current) return;
    const from = toward(ref.current, "[data-deck]");
    if (!from) return;
    const flight = animate(ref.current, { x: [from.x, 0], y: [from.y, 0], scale: [DECK_W / width, 1], rotate: [spin, 0] }, { duration: 0.34 * PACE, ease: FLIGHT });
    return () => flight.cancel();
    // Only ever on arriving.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span ref={ref} className={cn("block", className)}>
      {children}
    </span>
  );
}

// A number that counts its way to a new value.
export function Roll({ value, prefix = "" }: { value: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const was = useRef(value);
  const still = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || was.current === value) return;
    const write = (v: number) => {
      was.current = v;
      el.textContent = prefix + chips(Math.round(v));
    };
    if (still) return write(value);
    const roll = animate(was.current, value, { duration: 0.42 * PACE, ease: "easeOut", onUpdate: write, onComplete: () => write(value) });
    return () => roll.stop();
  }, [value, prefix, still]);
  return <span ref={ref}>{prefix + chips(Math.round(was.current))}</span>;
}
