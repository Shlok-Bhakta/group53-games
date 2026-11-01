import { v, type Vec, type Wall, type Zone } from "./engine";
import { dcos, dsin } from "./dmath";
import { baffle, boost, build, ramp, type Hole } from "./plains";
import { blob, P, rect, rrect } from "./shapes";

// Cold Start: nine holes on packed snow, where everything slides further than you meant it to. Polished
// ice is slicker still, snow drifts are the only brakes, and the water's as cold as it looks. The
// first few teach the slide; the last few are about where you stop.

const ice = (poly: Vec[]): Zone => ({ kind: "ice", poly });
const snow = (poly: Vec[]): Zone => ({ kind: "snow", poly });
const water = (poly: Vec[]): Zone => ({ kind: "water", poly });
const wind = (poly: Vec[], dx: number, dy: number, strength: number): Zone => ({ kind: "wind", poly, dir: v(dx, dy), strength });
// A curved rail: part of an ellipse, in radians with y down.
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 14): Wall {
  const pts: Vec[] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    pts.push(v(cx + dcos(a) * rx, cy + dsin(a) * ry));
  }
  return { pts, w: 0.5, h: 0.6, style: "ice" };
}

const COLD: Partial<Hole> = { theme: "ice", surface: "packed" };

const HOLES: Hole[] = [
  {
    // Straight up, across a sheet of ice. Hit it like you would on grass and it's gone.
    id: "cold-1",
    name: "Thin Ice",
    par: 2,
    tee: v(11, 31),
    cup: v(11, 7),
    board: rrect(7, 3, 8, 32, 1),
    bumpers: [[13, 17.5, 0.9]],
    zones: [ice(rect(7, 12, 8, 12)), snow(rect(7, 3, 8, 2))],
    boxes: [v(9, 27)],
  },
  {
    // A corner on ice, with the cup down a side street behind two bumpers.
    id: "cold-2",
    name: "Zamboni",
    par: 3,
    tee: v(15, 32),
    cup: v(6, 8.5),
    board: P(11, 36, 19, 36, 19, 4, 2, 4, 2, 13, 11, 13),
    bumpers: [[15.5, 8.5, 0.85], [10, 5.6, 0.6], [10, 11.4, 0.6]],
    zones: [ice(rect(11, 4, 8, 14)), snow(rect(2, 4, 3.6, 9))],
    boxes: [v(17.3, 26)],
  },
  {
    // Two snow drifts across the way, each with a gap on the other side from the last.
    id: "cold-3",
    name: "Snowplow",
    par: 3,
    tee: v(11, 33),
    cup: v(11, 6.5),
    board: rrect(3, 3, 16, 33, 3),
    bumpers: [[16, 25.6, 0.8], [6, 15.6, 0.8], [11, 10.2, 0.6]],
    zones: [ice(rect(3, 18, 16, 5.5)), snow(rect(3, 24, 10.5, 3.2)), snow(rect(8.5, 14, 10.5, 3.2))],
    boxes: [v(5.5, 30), v(16.8, 8.5)],
  },
  {
    // Freezing water right across the hole. A thin ice bridge in the middle, or the ramp on the right.
    id: "cold-4",
    name: "Crevasse",
    par: 4,
    tee: v(8, 33),
    cup: v(11, 7),
    board: rect(4, 3, 14, 34),
    bumpers: [[7, 11, 0.8], [15, 11, 0.8]],
    zones: [water(rect(4, 18, 14, 4)), ice(rect(9.5, 17.6, 3, 4.8)), boost(15, 30.5, 0, -1), ramp(15, 26, 0, -1)],
    boxes: [v(6, 7)],
  },
  {
    // The cup's inside an igloo, and the door faces away from you.
    id: "cold-5",
    name: "Igloo",
    par: 4,
    tee: v(11, 33),
    cup: v(11, 12.5),
    board: rrect(2, 3, 18, 33, 4),
    bumpers: [[5.5, 24, 0.8], [16.5, 24, 0.8], [11, 22.5, 0.8], [6, 6.5, 0.7], [16, 6.5, 0.7]],
    walls: [arc(11, 12.5, 4.8, 4.8, -1.05, 4.19, 20)],
    zones: [ice(rect(2, 3, 18, 3)), ice(rect(2, 6, 3.4, 15)), ice(rect(16.6, 6, 3.4, 15))],
    boxes: [v(4.5, 31), v(17.5, 31)],
  },
  {
    // Through a gap on the right, back across against the wind, through a gap on the left.
    id: "cold-6",
    name: "Slipstream",
    par: 4,
    tee: v(7, 34),
    cup: v(6, 7),
    board: P(2, 38, 12, 38, 12, 26, 20, 26, 20, 14, 10, 14, 10, 3, 2, 3),
    bumpers: [[14, 20, 0.85], [6, 10.5, 0.6]],
    walls: [baffle(2, 26, 8, 26), baffle(5.5, 14, 10, 14)],
    zones: [ice(rect(2, 29, 10, 3)), wind(rect(2, 14, 18, 12), 1, 0, 6), snow(rect(2, 3, 8, 1.8))],
    boxes: [v(17.5, 23), v(4, 17)],
  },
  {
    // Downhill all the way: three blocks of ice sliding across the chute, in no hurry to let you past.
    id: "cold-7",
    name: "Avalanche",
    par: 3,
    tee: v(11, 5),
    cup: v(11, 33),
    board: rect(3, 2, 16, 36),
    bumpers: [[7, 31, 0.7], [15, 31, 0.7]],
    movers: [
      { kind: "slider", a: v(6.8, 12), b: v(15.2, 12), size: v(3.5, 1.4), period: 5 },
      { kind: "slider", a: v(15.2, 20), b: v(6.8, 20), size: v(3.5, 1.4), period: 4, phase: 0.3 },
      { kind: "slider", a: v(6.8, 27), b: v(15.2, 27), size: v(3.5, 1.4), period: 3.5, phase: 0.6 },
    ],
    zones: [ice(rect(3, 14, 16, 12)), snow(rect(3, 35.6, 16, 2.4))],
    boxes: [v(5, 8.5), v(17, 24)],
  },
  {
    // Ice floes in open water, a ramp on each pointing at the next. Land soft or keep going.
    id: "cold-8",
    name: "Whiteout",
    par: 6,
    tee: v(9, 64),
    cup: v(31, 10),
    board: [blob(12, 62, 8.5, 7, 3, 0.06, 28), blob(30, 46, 8.5, 7.5, 5, 0.06, 28), blob(13, 28, 9, 7.5, 7, 0.06, 28), blob(31, 10, 8.5, 7.5, 9, 0.06, 28)],
    off: "water",
    rim: false,
    bumpers: [[27, 7, 0.7], [35.5, 13, 0.7]],
    walls: [arc(30, 46, 7.6, 6.7, -1.9, 2, 20), arc(13, 28, 8.1, 6.7, 1.3, 5, 20), arc(31, 10, 7.6, 6.7, -2.6, 1.7, 20)],
    mines: [v(34, 49.5), v(9, 24.5)],
    zones: [
      boost(12.4, 61.4, 0.7071, -0.7071),
      ramp(15.6, 58.2, 0.7071, -0.7071),
      snow(blob(33.5, 47.5, 3.6, 4, 11, 0.08, 20)),
      boost(29.4, 45.6, -0.75, -0.66),
      ramp(26, 42.6, -0.75, -0.66),
      snow(blob(9.5, 29.5, 3.6, 3.8, 13, 0.08, 20)),
      boost(13.6, 27.2, 0.7071, -0.7071),
      ramp(16.8, 24, 0.7071, -0.7071),
    ],
    boxes: [v(6.5, 59), v(34.5, 42.5), v(8, 31)],
  },
  {
    // The finale, three chambers long: a spinning bar in the first door, a block sliding through
    // the rink, mines round the cup, and a portal that skips the lot if you can stop on it.
    id: "cold-9",
    name: "Absolute Zero",
    par: 6,
    tee: v(16, 62),
    cup: v(16, 9),
    board: rrect(2, 2, 28, 64, 5),
    bumpers: [[9, 38, 0.8], [23, 38, 0.8], [16, 30, 0.8], [6, 31, 0.7], [26, 31, 0.7]],
    walls: [baffle(2, 46, 12.2, 46), baffle(19.8, 46, 30, 46), baffle(9, 22, 23, 22)],
    movers: [
      { kind: "spinner", at: v(16, 46), L: 3, arms: 2, omega: 1.5, w: 0.5 },
      { kind: "slider", a: v(9, 34.5), b: v(23, 34.5), size: v(1.4, 2.6), period: 6 },
    ],
    portals: [{ a: v(5.5, 60), b: v(26.5, 6.5) }],
    mines: [v(11.6, 9), v(20.4, 9), v(16, 13.6), v(12.8, 12.6), v(19.2, 12.6), v(12.8, 5.4), v(19.2, 5.4)],
    zones: [ice(rect(2, 24, 28, 21)), snow(rect(2, 2, 7, 4)), snow(rect(23, 15, 7, 6)), snow(rect(2, 15, 7, 6))],
    boxes: [v(26, 42), v(6, 42), v(5, 12), v(27, 12)],
  },
];

export const COLD_START = HOLES.map((h) => build({ ...COLD, ...h }, "Cold Start"));
