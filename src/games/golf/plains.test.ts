import { describe, expect, test } from "vitest";
import { BALL_R, CUP_R, DT, JUMBO, closest, compile, fireTargeted, groundAt, newSim, shoot, step, v, type Course, type Sim, type World } from "./engine";
import { BATTLE_GROUNDS } from "./battle";
import { BUMPER_PLAINS } from "./plains";

const ALL = [...BUMPER_PLAINS, ...BATTLE_GROUNDS];
const roll = (sim: Sim, world: World, seconds = 30) => {
  for (let i = 0; i < seconds / DT && (sim.mode === "roll" || sim.mode === "out"); i++) step(sim, world);
};
// A long plain lane with one bumper in it, for trying items.
const lane = (extra: Partial<Course> = {}): Course => ({
  id: "lane", name: "Lane", course: "Test", theme: "hills", par: 3, w: 20, h: 90, tee: v(10, 80), cup: v(10, 6), off: "oob",
  greens: [{ poly: [v(4, 2), v(16, 2), v(16, 86), v(4, 86)] }],
  zones: [], walls: [], blocks: [], props: [], bumpers: [{ at: v(10, 60), r: 0.85, kick: 5 }], movers: [], portals: [], wells: [], lamps: [], boxes: [],
  ...extra,
});

describe("Bumper Plains", () => {
  test("six holes, every one with bumpers", () => {
    expect(BUMPER_PLAINS).toHaveLength(6);
    for (const c of BUMPER_PLAINS) expect(c.bumpers.length).toBeGreaterThan(0);
  });

  test("Battle Grounds: three big holes with mines, speed pads and ramps", () => {
    expect(BATTLE_GROUNDS).toHaveLength(3);
    expect(BATTLE_GROUNDS.some((c) => (c.mines ?? []).length > 0)).toBe(true);
    expect(BATTLE_GROUNDS.some((c) => c.zones.some((z) => z.kind === "ramp"))).toBe(true);
    for (const c of BATTLE_GROUNDS) expect(Math.hypot(c.cup.x - c.tee.x, c.cup.y - c.tee.y)).toBeGreaterThan(30);
  });

  test.each(ALL.map((c) => [c.name, c] as const))("%s: tee, cup and boxes on the board, clear of walls and bumpers", (_, c) => {
    const world = compile(c);
    for (const p of [c.tee, c.cup, ...c.boxes]) {
      expect(groundAt(world, p)).toBe("green");
      for (const s of world.segs) {
        const q = closest(p, s.a, s.b);
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(s.r + BALL_R + 0.3);
      }
      for (const b of c.bumpers) expect(Math.hypot(p.x - b.at.x, p.y - b.at.y)).toBeGreaterThan(b.r + CUP_R + 0.5);
    }
  });

  test.each(ALL.map((c) => [c.name, c] as const))("%s: a straight shot at the cup from the tee doesn't go in", (_, c) => {
    const world = compile(c);
    for (const power of [0.3, 0.45, 0.6, 0.8]) {
      const sim = newSim(c);
      shoot(sim, Math.atan2(c.cup.y - c.tee.y, c.cup.x - c.tee.x), power);
      for (let i = 0; i < 30 / DT && sim.mode === "roll"; i++) step(sim, world);
      expect(sim.mode).not.toBe("sunk");
    }
  });

  test("a bumper fires the ball back faster than it came", () => {
    const c = BUMPER_PLAINS[0];
    const world = compile(c);
    const sim = newSim(c);
    shoot(sim, -Math.PI / 2, 0.55);
    let hit = false;
    for (let i = 0; i < 10 / DT && sim.mode === "roll"; i++) {
      const before = sim.vy;
      step(sim, world);
      if (sim.events.some((e) => e.type === "bump")) {
        hit = true;
        expect(sim.vy).toBeGreaterThan(Math.abs(before));
        break;
      }
    }
    expect(hit).toBe(true);
  });
});

describe("items", () => {
  const up = -Math.PI / 2;

  test("a landmine throws the ball and is gone", () => {
    const c = lane({ bumpers: [], mines: [v(10, 70)] });
    const world = compile(c);
    const sim = newSim(c);
    shoot(sim, up, 0.5);
    let flew = 0;
    for (let i = 0; i < 20 / DT && sim.mode === "roll"; i++) {
      step(sim, world);
      flew = Math.max(flew, sim.z);
    }
    expect(sim.mines[0].live).toBe(false);
    expect(flew).toBeGreaterThan(0.5);
  });

  test("an Orbital Laser blows up the bumpers where it lands, a moment later", () => {
    const c = lane();
    const world = compile(c);
    const sim = newSim(c);
    sim.bag = ["laser"];
    fireTargeted(sim, c, 0, v(10, 60));
    expect(sim.bag).toEqual([]);
    expect(sim.gone[0]).toBe(false);
    for (let i = 0; i < 1 / DT; i++) step(sim, world);
    expect(sim.gone[0]).toBe(true);
  });

  test("a Rail Gun takes out the bumper in its line and leaves the rest", () => {
    const c = lane({ bumpers: [{ at: v(10, 60), r: 0.85, kick: 5 }, { at: v(14, 40), r: 0.85, kick: 5 }] });
    const sim = newSim(c);
    sim.bag = ["railgun"];
    fireTargeted(sim, c, 0, v(10, 10));
    expect(sim.gone).toEqual([true, false]);
  });

  test("a dropped landmine waits where it was put", () => {
    const c = lane();
    const sim = newSim(c);
    sim.bag = ["mine"];
    fireTargeted(sim, c, 0, v(8, 30));
    expect(sim.mines).toEqual([{ x: 8, y: 30, live: true }]);
  });

  test("a Jumbo Burger makes the ball huge and it flattens a bumper instead of bouncing", () => {
    const c = lane();
    const world = compile(c);
    const sim = newSim(c);
    sim.armed = "jumbo";
    shoot(sim, up, 0.6);
    expect(sim.r).toBeCloseTo(BALL_R * JUMBO);
    roll(sim, world);
    expect(sim.gone[0]).toBe(true);
    expect(sim.y).toBeLessThan(60);
    expect(sim.r).toBe(BALL_R);
  });

  test("a Smoke Bomb lets the ball roll straight through a bumper", () => {
    const c = lane();
    const world = compile(c);
    const sim = newSim(c);
    sim.armed = "smoke";
    shoot(sim, up, 0.6);
    roll(sim, world);
    expect(sim.y).toBeLessThan(58);
    expect(sim.gone[0]).toBe(false);
  });

  test("Spring Boots fly the ball over a wall; a Golf Cart goes further than a plain shot", () => {
    const wall = { pts: [v(4, 70), v(16, 70)], w: 0.5, h: 0.6, style: "wood" as const };
    const c = lane({ bumpers: [], walls: [wall] });
    const world = compile(c);
    const sprung = newSim(c);
    sprung.armed = "spring";
    shoot(sprung, up, 0.7);
    roll(sprung, world);
    expect(sprung.y).toBeLessThan(70);

    const open = lane({ bumpers: [] });
    const w2 = compile(open);
    const plain = newSim(open), cart = newSim(open);
    shoot(plain, up, 0.4);
    cart.armed = "cart";
    shoot(cart, up, 0.4);
    roll(plain, w2);
    roll(cart, w2);
    expect(cart.y).toBeLessThan(plain.y - 5);
  });
});
