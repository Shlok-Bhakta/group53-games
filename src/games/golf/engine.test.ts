import { describe, expect, test } from "vitest";
import { GREEN_HILLS } from "./courses";
import { BALL_R, CUP_R, DT, HAZARDS, activate, closest, compile, groundAt, newSim, poseOf, shoot, step, v, type Course, type Ground, type Sim, type World } from "./engine";
import { MAX_ROLL, generate, powerFor } from "./gen";

const settle = (sim: Sim, world: World, seconds = 40) => {
  for (let i = 0; i < seconds / DT && (sim.mode === "roll" || sim.mode === "out"); i++) step(sim, world);
  return sim;
};
const box = (x0: number, y0: number, x1: number, y1: number) => [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];

// A plain walled green, 20 by 60, with whatever's added on top.
function plain(extra: Partial<Course> = {}): Course {
  return {
    id: "test", name: "Test", course: "Test", theme: "hills", par: 3, w: 30, h: 70,
    tee: v(15, 60), cup: v(15, 10), off: "oob",
    greens: [{ poly: box(5, 5, 25, 65) }],
    zones: [], walls: [], blocks: [], props: [], bumpers: [], movers: [], portals: [], wells: [], lamps: [], boxes: [],
    ...extra,
  };
}

describe("golf generator", () => {
  test("the same seed always makes the same hole", () => {
    const a = generate(GREEN_HILLS[0])!, b = generate(GREEN_HILLS[0])!;
    expect(a).not.toBeNull();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test.each(GREEN_HILLS.map((s) => [s]))("Green Hills seed %i: a long hole that plays", (seed) => {
    const c = generate(seed)!;
    expect(c).not.toBeNull();
    const world = compile(c);
    expect(c.stats.length).toBeGreaterThan(60);
    expect(c.par).toBeGreaterThanOrEqual(3);
    // The bot got round, and not in one or two.
    expect(c.stats.bot).toBeGreaterThan(2);
    expect(c.stats.bot).toBeLessThanOrEqual(c.par + 2);
    for (const p of [c.tee, c.cup, ...c.boxes]) expect(HAZARDS).not.toContain(groundAt(world, p));
    for (const p of [c.tee, c.cup])
      for (const s of world.segs) {
        const q = closest(p, s.a, s.b);
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(s.r + BALL_R);
      }
    // Straight at the cup from the tee is never a hole in one.
    const sim = newSim(c);
    shoot(sim, Math.atan2(c.cup.y - c.tee.y, c.cup.x - c.tee.x), powerFor(Math.hypot(c.cup.x - c.tee.x, c.cup.y - c.tee.y)));
    settle(sim, world);
    expect(sim.mode).not.toBe("sunk");
  });

  test("most seeds are thrown out, but plenty make it", () => {
    let made = 0;
    for (let s = 500; s < 520; s++) if (generate(s)) made++;
    expect(made).toBeGreaterThan(1);
    expect(made).toBeLessThan(20);
  }, 60_000);
});

describe("golf physics", () => {
  test("a full-power putt rolls about as far as the generator thinks", () => {
    const c = plain({ greens: [{ poly: box(5, 5, 25, 200) }], h: 210, tee: v(15, 190) });
    const sim = newSim(c);
    shoot(sim, -Math.PI / 2, 1);
    settle(sim, compile(c));
    expect(190 - sim.y).toBeGreaterThan(MAX_ROLL * 0.9);
    expect(190 - sim.y).toBeLessThan(MAX_ROLL * 1.1);
  });

  test("a gentle putt drops; a hard one lips out and keeps going", () => {
    const c = plain();
    const world = compile(c);
    const soft = newSim(c);
    Object.assign(soft, { x: 15, y: 13 });
    shoot(soft, -Math.PI / 2, powerFor(3.4));
    settle(soft, world);
    expect(soft.mode).toBe("sunk");

    const hard = newSim(c);
    Object.assign(hard, { x: 15 + CUP_R * 0.6, y: 12 });
    shoot(hard, -Math.PI / 2, 0.95);
    for (let i = 0; i < 0.3 / DT; i++) step(hard, world);
    expect(hard.mode).toBe("roll");
  });

  test("water costs a stroke and puts the ball back where it was hit from", () => {
    const c = plain({ zones: [{ kind: "water", poly: box(5, 30, 25, 34) }] });
    const sim = newSim(c);
    shoot(sim, -Math.PI / 2, 0.8);
    settle(sim, compile(c));
    expect(sim.strokes).toBe(2);
    expect(sim.mode).toBe("aim");
    expect(sim.y).toBeCloseTo(60);
  });

  test("a ramp throws the ball over a stream; landing outside the walls is out of bounds", () => {
    const c = plain({ zones: [{ kind: "water", poly: box(5, 38, 25, 42) }, { kind: "ramp", poly: box(13.7, 48, 16.3, 51), dir: v(0, -1), lift: 0.62 }] });
    const world = compile(c);
    const sim = newSim(c);
    let flew = 0;
    shoot(sim, -Math.PI / 2, 0.9);
    for (let i = 0; i < 30 / DT && sim.mode === "roll"; i++) {
      step(sim, world);
      flew = Math.max(flew, sim.z);
    }
    expect(flew).toBeGreaterThan(0.7);
    expect(sim.strokes).toBe(1);
    expect(sim.y).toBeLessThan(38);
    expect(groundAt(world, v(2, 30))).toBe<Ground>("oob");
  });

  test("islands are holes in the green", () => {
    const c = plain({ greens: [{ poly: box(5, 5, 25, 65) }, { poly: box(12, 30, 18, 36) }] });
    const world = compile(c);
    expect(groundAt(world, v(15, 33))).toBe("oob");
    expect(groundAt(world, v(8, 33))).toBe("green");
  });

  test("the same shot at the same moment plays out exactly the same", () => {
    const c = generate(GREEN_HILLS[1])!;
    const world = compile(c);
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
    const c = plain();
    const sim = newSim(c);
    sim.bag = ["mulligan"];
    shoot(sim, -1.2, 0.5);
    settle(sim, compile(c));
    activate(sim, 0);
    expect(sim.strokes).toBe(0);
    expect(sim.x).toBeCloseTo(15);
    expect(sim.bag).toEqual([]);
  });

  test("ice barely slows the ball; sand stops it fast", () => {
    const roll = (kind: "green" | "ice" | "sand") => {
      const flat = plain({ greens: [], zones: [{ kind, poly: box(0, 0, 999, 999) }], w: 999, h: 999 });
      const sim = newSim(flat);
      Object.assign(sim, { x: 10, y: 500 });
      shoot(sim, 0, 0.3);
      settle(sim, compile(flat), 60);
      return sim.x - 10;
    };
    expect(roll("ice")).toBeGreaterThan(roll("green") * 3);
    expect(roll("sand")).toBeLessThan(roll("green") / 2);
  });

  test("windmill blades open and close", () => {
    const mill = { kind: "windmill" as const, hub: v(0, 0), L: 3, arms: 4, omega: 1.3, mouth: [v(-1, 0), v(1, 0)] as [typeof v extends (...a: never[]) => infer R ? R : never, ReturnType<typeof v>], height: 2.7 };
    const states = new Set<boolean>();
    for (let t = 0; t < 6; t += 0.05) {
      const pose = poseOf(mill, t);
      if (pose.kind === "windmill") states.add(pose.closed);
    }
    expect(states).toEqual(new Set([true, false]));
  });
});
