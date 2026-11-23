import { FRAME_COLOR } from "../../../convex/palette";
import { CUSTOM_COLOR_FRAMES } from "../../../convex/profileOptions";
import { SERIES } from "./palette";

type Colored = { color: string; dash?: string };
type Swatch = readonly [light: string, dark: string];

const FRAME_HUES: Record<string, string> = {
  gold: FRAME_COLOR.gold,
  fire: FRAME_COLOR.red,
  ice: FRAME_COLOR.cyan,
  toxic: FRAME_COLOR.green,
};
const UNUSABLE_AS_A_LINE = new Set<string>([FRAME_COLOR.white]);
export const TOO_CLOSE = 0.1;

export function cardColor(frame?: string, frameColor?: string) {
  if (!frame) return undefined;
  const own = (CUSTOM_COLOR_FRAMES as readonly string[]).includes(frame) ? frameColor : FRAME_HUES[frame];
  return own && !UNUSABLE_AS_A_LINE.has(own) ? own : undefined;
}

function oklab(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [channel(1), channel(3), channel(5)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

function apart(a: string, b: string) {
  if (!isHex(a) || !isHex(b)) return a === b ? 0 : Infinity;
  const [x, y] = [oklab(a), oklab(b)];
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}

export const swatchesApart = (a: Swatch, b: Swatch) => Math.min(apart(a[0], b[0]), apart(a[1], b[1]));
const nearest = (s: Swatch, taken: Swatch[]) => Math.min(Infinity, ...taken.map((t) => swatchesApart(s, t)));
const seriesSwatch = (i: number): Swatch => [SERIES.light[i], SERIES.dark[i]];

export function playerColors(crew: { userId: string; joinedAt: number; frame?: string; frameColor?: string }[]) {
  const taken: Swatch[] = [];
  const out = new Map<string, Colored>();
  const byJoin = [...crew].sort((a, b) => a.joinedAt - b.joinedAt);
  for (const c of byJoin) {
    const own = cardColor(c.frame, c.frameColor);
    if (own && nearest([own, own], taken) >= TOO_CLOSE) {
      taken.push([own, own]);
      out.set(c.userId, { color: own });
    }
  }
  const free = SERIES.light.map((_, i) => i);
  let extra = 0;
  for (const c of byJoin) {
    if (out.has(c.userId)) continue;
    if (free.length === 0) {
      out.set(c.userId, { color: `var(--series-${(extra % 8) + 1})`, dash: "6 4" });
      extra++;
      continue;
    }
    const pick = free.find((i) => nearest(seriesSwatch(i), taken) >= TOO_CLOSE) ?? farthest(free, taken);
    free.splice(free.indexOf(pick), 1);
    taken.push(seriesSwatch(pick));
    out.set(c.userId, { color: `var(--series-${pick + 1})` });
  }
  return out;
}

function farthest(free: number[], taken: Swatch[]) {
  return free.reduce((best, i) => (nearest(seriesSwatch(i), taken) > nearest(seriesSwatch(best), taken) ? i : best));
}

const TIERS = [0.0025, 0.02, 0.05, 0.1];
const tierOf = (pct: number) => TIERS.filter((t) => Math.abs(pct) >= t).length;

export function gainColor(pct: number) {
  const hue = pct > 0 ? "var(--up)" : "var(--down)";
  return [
    "color-mix(in oklch, var(--muted-foreground) 45%, var(--card))",
    `color-mix(in oklch, ${hue} 45%, white)`,
    `color-mix(in oklch, ${hue} 72%, white)`,
    hue,
    `color-mix(in oklch, ${hue} var(--deep), black)`,
  ][tierOf(pct)];
}

export function moveInk(pct: number) {
  const hue = pct < 0 ? "var(--down)" : "var(--up)";
  return [
    `color-mix(in oklab, ${hue} 30%, var(--muted-foreground))`,
    `color-mix(in oklab, ${hue} 55%, var(--muted-foreground))`,
    `color-mix(in oklab, ${hue} 80%, var(--muted-foreground))`,
    hue,
    `color-mix(in oklch, ${hue}, black var(--ink-deepen))`,
  ][tierOf(pct)];
}
