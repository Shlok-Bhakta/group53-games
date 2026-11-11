import { POWERS, groundAt, HAZARDS, inPoly, rng, type Course, type Power, type Vec } from "./engine";
import { hyp } from "./dmath";
import { COURSES, worldOf } from "./holes";
import { generateHole } from "./gen";
import { maskOn, type Settings } from "../modes";

// A game's holes, from its settings (convex/modes.ts, GOLF): one of the courses made by hand, or holes
// generated from the seed (gen.ts), with the game's item boxes and items. The same settings always build
// the same holes, so a seed can be played again. Every hole gets the id of the world it's played in.

export const holeKey = (matchId: string, n: number) => `m:${matchId}:${n}`;

// How many holes a game has. A course made by hand has nine; eighteen of one is both.
export const holeCount = (s: Settings) => s.holes ?? 9;

function handmade(s: Settings, n: number): Course {
  const first = s.course === 2 ? COURSES[1] : COURSES[0];
  const all = s.holes === 18 ? [...first.holes, ...COURSES.find((c) => c !== first)!.holes] : first.holes;
  return all[n % all.length];
}

// What the game's boxes can give: every item, or the ones ticked.
export function powersOf(s: Settings): Power[] | undefined {
  const mask = s.items ?? 2 ** POWERS.length - 1;
  const on = POWERS.filter((_, i) => maskOn(mask, i));
  return on.length === POWERS.length || on.length === 0 ? undefined : on;
}

// More or fewer boxes than the hole came with: "Few" keeps every other one, "Lots" adds as many again
// in clear spots on the ground.
function boxesFor(c: Course, level: number, seed: number): Vec[] {
  if (level === 0) return [];
  if (level === 1) return c.boxes.filter((_, i) => i % 2 === 0);
  if (level === 2) return c.boxes;
  const w = worldOf(c);
  const r = rng(seed);
  const extra: Vec[] = [];
  const want = Math.max(2, c.boxes.length);
  const busy = [c.tee, c.cup, ...c.boxes, ...(c.mines ?? []), ...c.bumpers.map((b) => b.at)];
  for (let i = 0; i < 400 && extra.length < want; i++) {
    const p = { x: r() * c.w, y: r() * c.h };
    const g = groundAt(w, p);
    if (HAZARDS.includes(g) || g === "sand" || g === "rough") continue;
    if (!c.greens.some((gr) => inPoly(p, gr.poly))) continue;
    if (c.zones.some((z) => (z.kind === "boost" || z.kind === "ramp") && inPoly(p, z.poly))) continue;
    if ([...busy, ...extra].some((q) => hyp(q.x - p.x, q.y - p.y) < 3)) continue;
    if (w.segs.some((sg) => {
      const dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - sg.a.x) * dx + (p.y - sg.a.y) * dy) / l2));
      return hyp(p.x - sg.a.x - dx * t, p.y - sg.a.y - dy * t) < sg.r + 1.2;
    })) continue;
    extra.push(p);
  }
  return [...c.boxes, ...extra];
}

// What the generator's output depends on: the same key always builds the same holes, so they can be
// generated once (a preview on the mode page) and used again when the game starts.
export const genOpts = (s: Settings, n: number) => ({ seed: s.seed ?? 1, n, terrain: s.terrain ?? 0, style: s.style ?? 2, hazards: s.hazards ?? 1 });
export const genKey = (s: Settings) => {
  const o = genOpts(s, 0);
  return `${o.seed}:${o.terrain}:${o.style}:${o.hazards}`;
};

// Hole `n` of a game. `made`: the generated hole, if it's already been made (a preview).
export function buildHole(s: Settings, n: number, key: string, made?: Course): Course {
  const seed = s.seed ?? 1;
  const base = s.course === 0 ? (made ?? generateHole(genOpts(s, n))) : handmade(s, n);
  const powers = powersOf(s);
  // The id goes first: the hole's compiled walls and distances are kept by it.
  const out: Course = { ...base, id: key, boxes: boxesFor(base, s.boxes ?? 2, seed * 31 + n), ...(powers ? { powers } : {}) };
  return out;
}
