import { BATTLE_GROUNDS } from "./battle";
import { COLD_START } from "./coldstart";
import { closest, compile, groundAt, inPoly, type Course, type Vec, type World } from "./engine";
import { hyp } from "./dmath";
import { BUMPER_PLAINS } from "./plains";
import { SANDBOX } from "./sandbox";

export function withTees(c: Course): Course {
  const w = compile(c);
  const tg = groundAt(w, c.tee);
  const clear = (p: Vec) => {
    if (groundAt(w, p) !== tg) return false;
    if (c.zones.some((z) => z.kind !== tg && inPoly(p, z.poly))) return false;
    if (w.segs.some((s) => hyp(p.x - closest(p, s.a, s.b).x, p.y - closest(p, s.a, s.b).y) < s.r + 0.8)) return false;
    if (c.bumpers.some((b) => hyp(p.x - b.at.x, p.y - b.at.y) < b.r + 0.9)) return false;
    return [...c.boxes, ...(c.mines ?? []), c.cup].every((o) => hyp(p.x - o.x, p.y - o.y) > 1.8);
  };
  const near: [number, number][] = [
    [-1.8, 0],
    [1.8, 0],
    [0, 1.8],
    [0, -1.8],
    [-1.8, 1.8],
    [1.8, 1.8],
    [-1.8, -1.8],
    [1.8, -1.8],
  ];
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

export function holeOf(key: string) {
  const co = COURSES.find((c) => c.holes.some((h) => h.id === key));
  return co ? { course: co.id, number: co.holes.findIndex((h) => h.id === key) + 1 } : null;
}

export function courseOf(key: string): Course | null {
  return key === SANDBOX.id ? SANDBOX : (HOLES.find((h) => h.id === key) ?? null);
}
const compiled = new Map<string, World>();
export function worldOf(course: Course) {
  let w = compiled.get(course.id);
  if (
    w &&
    w.course !== course &&
    (w.course.w !== course.w ||
      w.course.h !== course.h ||
      w.course.cup.x !== course.cup.x ||
      w.course.greens.length !== course.greens.length)
  )
    w = undefined;
  if (!w) {
    if (compiled.size > 120) compiled.clear();
    compiled.set(course.id, (w = compile(course)));
  }
  return w;
}
