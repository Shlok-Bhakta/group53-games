import { describe, expect, test } from "vitest";
import { COURSES, courseById } from "./courses";
import { BALL_R, CUP_R, DT, HAZARDS, activate, closest, compile, groundAt, newSim, poseOf, shoot, step, type Sim, type World } from "./engine";

const settle = (sim: Sim, world: World, seconds = 30) => {
  for (let i = 0; i < seconds / DT && (sim.mode === "roll" || sim.mode === "out"); i++) step(sim, world);
  return sim;
};
const aimAt = (sim: Sim, x: number, y: number) => Math.atan2(y - sim.y, x - sim.x);

describe("golf courses", () => {
  test("sixteen maps: three per theme plus four wild cards, one open world per theme", () => {
    expect(COURSES).toHaveLength(16);
    expect(new Set(COURSES.map((c) => c.id)).size).toBe(16);
    for (const theme of ["hills", "desert", "ice", "volcano"]) {
      const of = COURSES.filter((c) => c.theme === theme);
      expect(of).toHaveLength(3);
      expect(of.filter((c) => c.open)).toHaveLength(1);
    }
  });

  test.each(COURSES.map((c) => [c.id, c] as const))("%s: tee, cup and boxes sit on solid ground, clear of walls", (_, c) => {
    const world = compile(c);
    for (const p of [c.tee, c.cup, ...c.boxes]) {
      expect(HAZARDS).not.toContain(groundAt(world, p));
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(c.w);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(c.h);
    }
    for (const p of [c.tee, c.cup])
      for (const s of world.segs) {
        const q = closest(p, s.a, s.b);
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(s.r + BALL_R);
      }
  });

  test.each(COURSES.map((c) => [c.id, c] as const))("%s: a shot from the tee rolls and comes to rest", (_, c) => {
    const world = compile(c);
    const sim = newSim(c);
    shoot(sim, aimAt(sim, c.cup.x, c.cup.y), 0.35);
    settle(sim, world);
    expect(sim.mode === "aim" || sim.mode === "sunk").toBe(true);
    expect(sim.strokes).toBeGreaterThanOrEqual(1);
  });
});

describe("golf physics", () => {
  const c = courseById("windmill");
  const world = compile(c);

  test("a gentle putt drops; a hard one lips out and keeps going", () => {
    const soft = newSim(c);
    Object.assign(soft, { x: c.cup.x, y: c.cup.y + 2.5 });
    shoot(soft, -Math.PI / 2, 0.22);
    settle(soft, world);
    expect(soft.mode).toBe("sunk");

    const hard = newSim(c);
    Object.assign(hard, { x: c.cup.x + CUP_R * 0.6, y: c.cup.y + 1.5 });
    shoot(hard, -Math.PI / 2, 0.95);
    for (let i = 0; i < 0.3 / DT; i++) step(hard, world);
    expect(hard.mode).toBe("roll");
  });

  test("water costs a stroke and puts the ball back where it was hit from", () => {
    const sim = newSim(c);
    const pond = { x: 6.4, y: 25.6 };
    const from = { x: sim.x, y: sim.y };
    shoot(sim, aimAt(sim, pond.x, pond.y), 0.6);
    settle(sim, world);
    expect(sim.strokes).toBe(2);
    expect(sim.mode).toBe("aim");
    expect(sim.x).toBeCloseTo(from.x);
    expect(sim.y).toBeCloseTo(from.y);
  });

  test("a ramp throws the ball over the stone wall", () => {
    const sim = newSim(c);
    Object.assign(sim, { x: 16.6, y: 21.5 });
    shoot(sim, -Math.PI / 2, 0.8);
    let flew = 0;
    for (let i = 0; i < 30 / DT && sim.mode === "roll"; i++) {
      step(sim, world);
      flew = Math.max(flew, sim.z);
    }
    expect(flew).toBeGreaterThan(0.9);
    expect(sim.y).toBeLessThan(13.1);
  });

  test("the windmill's blades open and close the tunnel", () => {
    const mill = c.movers[0];
    const states = new Set<boolean>();
    for (let t = 0; t < 6; t += 0.05) {
      const pose = poseOf(mill, t);
      if (pose.kind === "windmill") states.add(pose.closed);
    }
    expect(states).toEqual(new Set([true, false]));
  });

  test("the same shot at the same moment plays out exactly the same", () => {
    const run = () => {
      const sim = newSim(c);
      for (let i = 0; i < 1.3 / DT; i++) step(sim, world);
      shoot(sim, -1.4, 0.7);
      settle(sim, world);
      return [sim.x, sim.y, sim.strokes, sim.mode];
    };
    expect(run()).toEqual(run());
  });

  test("a mulligan takes the last shot back", () => {
    const sim = newSim(c);
    sim.bag = ["mulligan"];
    shoot(sim, -1.2, 0.5);
    settle(sim, world);
    activate(sim, 0);
    expect(sim.strokes).toBe(0);
    expect(sim.x).toBeCloseTo(c.tee.x);
    expect(sim.bag).toEqual([]);
  });

  test("ice barely slows the ball; sand stops it fast", () => {
    const roll = (kind: "green" | "ice" | "sand") => {
      const flat = { ...c, zones: [{ kind, poly: [{ x: 0, y: 0 }, { x: 999, y: 0 }, { x: 999, y: 999 }, { x: 0, y: 999 }] }], greens: [], walls: [], blocks: [], props: [], movers: [], w: 999, h: 999, boxes: [] };
      const w = compile(flat);
      const sim = newSim(flat);
      Object.assign(sim, { x: 10, y: 500 });
      shoot(sim, 0, 0.3);
      settle(sim, w, 60);
      return sim.x - 10;
    };
    expect(roll("ice")).toBeGreaterThan(roll("green") * 3);
    expect(roll("sand")).toBeLessThan(roll("green") / 2);
  });
});
