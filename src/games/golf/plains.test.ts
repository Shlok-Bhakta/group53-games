import { describe, expect, test } from "vitest";
import { BALL_R, CUP_R, DT, closest, compile, groundAt, newSim, shoot, step } from "./engine";
import { BUMPER_PLAINS } from "./plains";

describe("Bumper Plains", () => {
  test("six holes, every one with bumpers", () => {
    expect(BUMPER_PLAINS).toHaveLength(6);
    for (const c of BUMPER_PLAINS) expect(c.bumpers.length).toBeGreaterThan(0);
  });

  test.each(BUMPER_PLAINS.map((c) => [c.name, c] as const))("%s: tee, cup and boxes on the board, clear of walls and bumpers", (_, c) => {
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

  test.each(BUMPER_PLAINS.map((c) => [c.name, c] as const))("%s: a straight shot at the cup from the tee doesn't go in", (_, c) => {
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
