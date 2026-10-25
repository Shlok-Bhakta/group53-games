import { FILES14, SIZE as SIZE4, onBoard as onBoard4, rotate, unrotate, type Color4 } from "../../../convex/chess/four/board";

export type Sq = [number, number];

// How a board sits on screen for one player: their army at the bottom. Works on fractional squares too,
// so pieces in flight map smoothly.
export type View = {
  n: number;
  toScreen: (x: number, y: number) => [number, number];
  fromScreen: (col: number, row: number) => Sq;
  onBoard: (x: number, y: number) => boolean;
  name: (sq: Sq) => string;
};

const FILES = "abcdefgh";
const COLORS4 = ["red", "blue", "yellow", "green"];

export function viewFor(variant: "two" | "four", color: string | undefined): View {
  if (variant === "four") {
    const c = (COLORS4.includes(color ?? "") ? color : "red") as Color4;
    return {
      n: SIZE4,
      toScreen: (x, y) => {
        const [ux, uy] = unrotate(c, x, y);
        return [ux, SIZE4 - 1 - uy];
      },
      fromScreen: (col, row) => rotate(c, col, SIZE4 - 1 - row),
      onBoard: onBoard4,
      name: ([x, y]) => `${FILES14[x]}${y + 1}`,
    };
  }
  const flip = color === "b";
  const map = (x: number, y: number): [number, number] => [flip ? 7 - x : x, flip ? y : 7 - y];
  return {
    n: 8,
    toScreen: map,
    fromScreen: map,
    onBoard: (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8,
    name: ([x, y]) => `${FILES[x]}${y + 1}`,
  };
}

export const same = (a: Sq | null | undefined, b: Sq | null | undefined) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

// Fractional screen square under a point, or null off the board's box.
export function pointToScreen(el: HTMLElement, n: number, clientX: number, clientY: number): [number, number] | null {
  const r = el.getBoundingClientRect();
  const fc = ((clientX - r.left) / r.width) * n;
  const fr = ((clientY - r.top) / r.height) * n;
  if (fc < 0 || fc >= n || fr < 0 || fr >= n) return null;
  return [fc, fr];
}

// On the 14x14 board squares are small, so a tap goes to the nearest candidate within reach of the finger.
export function nearest(view: View, candidates: Sq[], fc: number, fr: number, reach: number): Sq | null {
  let best: Sq | null = null;
  let bestD = reach;
  for (const sq of candidates) {
    const [c, r] = view.toScreen(sq[0], sq[1]);
    const d = Math.hypot(c + 0.5 - fc, r + 0.5 - fr);
    if (d < bestD) {
      best = sq;
      bestD = d;
    }
  }
  return best;
}

export const pieceSrc = (p: { color: string; kind: string; dead?: boolean }) =>
  p.color === "w" || p.color === "b" ? `/pieces/${p.color}${p.kind}.svg` : `/pieces/four/${p.dead ? "dead" : p.color}${p.kind}.svg`;
