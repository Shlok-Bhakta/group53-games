import { v, type Course, type Vec } from "./engine";
import { P, rect, rrect } from "./shapes";
import { baffle, boost, build, ramp, type Hole } from "./plains";

// Battle Grounds: three big holes in the spirit of Super Battle Golf. They take you somewhere:
// across minefields, over gaps in the void on jump ramps, along speed-pad highways. More boxes, more
// items, and bumpers and mines wherever they'll hurt most.

const HOLES: Hole[] = [
  {
    // A tee box, a field of mines and bumpers, a chokepoint, then speed pads into a ramp that has to
    // clear the void to reach the island green.
    id: "battle-1",
    name: "The Gauntlet",
    par: 5,
    tee: v(20, 94),
    cup: v(20, 7),
    board: [P(14, 98, 26, 98, 26, 80, 34, 80, 34, 50, 23, 50, 23, 40, 32, 40, 32, 22, 8, 22, 8, 40, 17, 40, 17, 50, 6, 50, 6, 80, 14, 80), rect(12, 2, 16, 12)],
    bumpers: [[16, 66], [24, 72], [20, 58], [12, 61], [28, 60], [20, 45, 0.9], [14, 34], [26, 34], [16, 10, 0.7], [24, 10, 0.7]],
    mines: [v(12, 70), v(28, 67), v(20, 64), v(10, 55), v(30, 54), v(24, 52), v(11, 27), v(29, 27)],
    zones: [boost(20, 34, 0, -1), boost(20, 30, 0, -1), ramp(20, 26, 0, -1)],
    boxes: [v(8, 76), v(32, 76), v(10, 37), v(30, 37), v(26, 5)],
  },
  {
    // Four islands in the void, each with a ramp pointing at the next, and bumpers where you land.
    id: "battle-2",
    name: "Island Hop",
    par: 5,
    tee: v(8, 59),
    cup: v(8.5, 25),
    board: [rect(4, 52, 16, 14), rect(28, 46, 16, 18), rect(26, 18, 20, 20), rrect(2, 18, 14, 14, 4)],
    bumpers: [[32, 61, 0.8], [40, 60, 0.8], [30, 51, 0.8], [41, 50, 0.8], [36, 28], [31, 33, 0.8], [42, 22, 0.8], [12, 22, 0.7], [12, 28, 0.7]],
    zones: [boost(11, 59, 1, 0), ramp(16, 59, 1, 0), boost(36, 55.5, 0, -1), ramp(36, 50.5, 0, -1), boost(35, 24.5, -1, 0), ramp(30, 24.5, -1, 0)],
    boxes: [v(12, 63.5), v(42, 62), v(44, 36), v(4.5, 30)],
  },
  {
    // A wide-open minefield straight at the cup, or the long way round up a speed-pad highway.
    id: "battle-3",
    name: "Minefield",
    par: 5,
    tee: v(36, 72),
    cup: v(36, 8),
    board: rrect(2, 2, 40, 76, 6),
    walls: [baffle(10, 16, 10, 72)],
    bumpers: [[24, 28], [32, 44], [18, 52], [28, 60], [31, 8, 0.8], [36, 13, 0.8]],
    mines: mines(),
    zones: [boost(6, 64, 0, -1), boost(6, 50, 0, -1), boost(6, 36, 0, -1), boost(6, 22, 0, -1)],
    boxes: [v(6, 43), v(26, 36), v(16, 70), v(40, 40), v(16, 6)],
  },
];

// A grid of mines with a few missing, so there's always a way through for someone brave.
function mines(): Vec[] {
  const out: Vec[] = [];
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 5; i++) {
      if ((i + j * 2) % 3 === 0) continue;
      const p = v(15 + i * 5.5 + (j % 2) * 2.5, 18 + j * 6.5);
      if (Math.hypot(p.x - 36, p.y - 72) < 5 || Math.hypot(p.x - 36, p.y - 8) < 5) continue;
      out.push(p);
    }
  return out;
}

export const BATTLE_GROUNDS: Course[] = HOLES.map((h) => build(h, "Battle Grounds"));
