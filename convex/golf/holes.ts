import { BATTLE_GROUNDS } from "./battle";
import { COLD_START } from "./coldstart";
import { closest, compile, groundAt, inPoly, type Course, type Vec, type World } from "./engine";
import { hyp } from "./dmath";
import { BUMPER_PLAINS } from "./plains";
import { SANDBOX } from "./sandbox";

// Golf's holes, nine to a course. Each hole is its own live world (convex/golf.ts), keyed by its id.
// Paths are /golf/<course>/<number>.

// More places to start, so a few players on one hole don't begin on top of each other: anywhere a step
// from the tee that's clear of the rails and everything on the board.
export function withTees(c: Course): Course {
  const w = compile(c);
  const tg = groundAt(w, c.tee);
  const clear = (p: Vec) => {
    // The same ground as the tee itself: the board, or a fairway's mown tee box.
    if (groundAt(w, p) !== tg) return false;
    if (c.zones.some((z) => z.kind !== tg && inPoly(p, z.poly))) return false;
    if (w.segs.some((s) => hyp(p.x - closest(p, s.a, s.b).x, p.y - closest(p, s.a, s.b).y) < s.r + 0.8)) return false;
    if (c.bumpers.some((b) => hyp(p.x - b.at.x, p.y - b.at.y) < b.r + 0.9)) return false;
    return [...c.boxes, ...(c.mines ?? []), c.cup].every((o) => hyp(p.x - o.x, p.y - o.y) > 1.8);
  };
  const near: [number, number][] = [[-1.8, 0], [1.8, 0], [0, 1.8], [0, -1.8], [-1.8, 1.8], [1.8, 1.8], [-1.8, -1.8], [1.8, -1.8]];
  const tees = near.map(([dx, dy]) => ({ x: c.tee.x + dx, y: c.tee.y + dy })).filter(clear);
  return { ...c, tees };
}

const nine = (id: string, name: string, holes: Course[]) => ({
  id,
  name,
  holes: holes.map((h, i) => withTees({ ...h, id: `${id}-${i + 1}`, course: name })),
});

export const COURSES = [nine("plains", "Bumper Plains", [...BUMPER_PLAINS, ...BATTLE_GROUNDS]), nine("cold", "Cold Start", COLD_START)];
export const HOLES = COURSES.flatMap((c) => c.holes);
export const courseById = (id: string) => COURSES.find((c) => c.id === id) ?? null;

// Which course a hole's in, and which hole of it, from its id.
export function holeOf(key: string) {
  const co = COURSES.find((c) => c.holes.some((h) => h.id === key));
  return co ? { course: co.id, number: co.holes.findIndex((h) => h.id === key) + 1 } : null;
}

// What a world is played on, from its key: a hole's id, or the open world's.
export function courseOf(key: string): Course | null {
  return key === SANDBOX.id ? SANDBOX : (HOLES.find((h) => h.id === key) ?? null);
}
const compiled = new Map<string, World>();
export function worldOf(course: Course) {
  let w = compiled.get(course.id);
  // A game's holes come and go: keep the cache from growing for good.
  if (!w) {
    if (compiled.size > 120) compiled.clear();
    compiled.set(course.id, (w = compile(course)));
  }
  return w;
}
