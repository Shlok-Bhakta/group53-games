import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { animate, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { chips } from "../format";
import { PACE } from "../show";

export const SPRING = [0.34, 1.45, 0.64, 1] as const;
export const FLIGHT = [0.2, 0.85, 0.25, 1] as const;
export const DECK_W = 28;

export function toward(el: HTMLElement, selector: string) {
  const there = el.closest("[data-table]")?.querySelector(selector)?.getBoundingClientRect();
  const here = el.getBoundingClientRect();
  if (!there) return null;
  return { x: there.left + there.width / 2 - (here.left + here.width / 2), y: there.top + there.height / 2 - (here.top + here.height / 2) };
}

export function Flying({
  width,
  fly,
  spin = -14,
  className,
  children,
}: {
  width: number;
  fly: boolean;
  spin?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
  const arrival = useRef({ fly, still, width, spin });
  useLayoutEffect(() => {
    const { fly, still, width, spin } = arrival.current;
    if (!fly || still || !ref.current) return;
    const from = toward(ref.current, "[data-deck]");
    if (!from) return;
    const flight = animate(
      ref.current,
      { x: [from.x, 0], y: [from.y, 0], scale: [DECK_W / width, 1], rotate: [spin, 0] },
      { duration: 0.34 * PACE, ease: FLIGHT },
    );
    return () => flight.cancel();
  }, []);
  return (
    <span ref={ref} className={cn("block", className)}>
      {children}
    </span>
  );
}

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
