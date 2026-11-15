import { v, type Bumper, type Course, type Vec, type Wall, type Zone } from "./engine";
import { dcos, dsin } from "./dmath";
import { blob, circle, rect, rrect } from "./shapes";

function smooth(pts: Vec[], rounds = 3): Vec[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const out: Vec[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length];
      out.push(v(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25), v(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75));
    }
    p = out;
  }
  return p;
}
const pts = (...n: number[]) => Array.from({ length: n.length / 2 }, (_, i) => v(n[i * 2], n[i * 2 + 1]));
const plate = (x: number, y: number, size: number) => rect(x - size / 2, y - size / 2, size, size);
const boost = (x: number, y: number, dx: number, dy: number): Zone => ({
  kind: "boost",
  poly: plate(x, y, 2.6),
  dir: v(dx, dy),
  strength: 45,
});
const ramp = (x: number, y: number, dx: number, dy: number, lift = 0.6): Zone => ({
  kind: "ramp",
  poly: plate(x, y, 3),
  dir: v(dx, dy),
  lift,
});
const bump = (x: number, y: number, r = 0.85): Bumper => ({ at: v(x, y), r, kick: 5 });
const rail = (...n: number[]): Wall => ({ pts: pts(...n), w: 0.5, h: 0.6, style: "wood" });

const ISLAND = smooth(
  pts(
    16,
    12,
    32,
    7,
    50,
    9,
    64,
    5,
    80,
    9,
    90,
    18,
    88,
    32,
    92,
    40,
    92,
    52,
    86,
    62,
    76,
    74,
    60,
    79,
    44,
    75,
    28,
    80,
    14,
    72,
    8,
    58,
    12,
    44,
    6,
    30,
  ),
);
const ISLET = circle(99, 46, 4.6, 28);
const LAGOON = blob(48, 40, 11.5, 7.5, 7, 0.07, 36);
const BRIDGE = rect(34.5, 38.2, 27, 3.6);

const isletRail = (): Wall => {
  const p: Vec[] = [];
  for (let k = 0; k <= 10; k++) {
    const a = -1.25 + (2.5 * k) / 10;
    p.push(v(99 + dcos(a) * 4.3, 46 + dsin(a) * 4.3));
  }
  return { pts: p, w: 0.5, h: 0.6, style: "wood" };
};

export const SANDBOX: Course = {
  id: "sandbox",
  name: "Driftwood Bay",
  course: "Sandbox",
  theme: "hills",
  par: 0,
  open: true,
  w: 106,
  h: 86,
  tee: v(48, 66),
  tees: [v(44, 68), v(52, 68), v(40, 65.5), v(56, 65.5), v(44, 63.5), v(52, 63.5), v(48, 70)],
  cup: v(20, 17),
  cups: [v(80, 14), v(99, 46), v(18, 57)],
  off: "water",
  greens: [
    { poly: ISLAND, rim: false },
    { poly: ISLET, rim: false },
  ],
  zones: [
    { kind: "ice", poly: rrect(19, 33, 13, 10.5, 3) },
    { kind: "water", poly: LAGOON },
    { kind: "bridge", poly: BRIDGE },
    { kind: "sand", poly: blob(13, 46, 4.5, 6.5, 3, 0.1, 24) },
    { kind: "sand", poly: blob(23.5, 61.5, 3, 2.2, 5, 0.1, 20) },
    { kind: "sand", poly: blob(76, 9.8, 2.6, 1.6, 9, 0.1, 18) },
    { kind: "sand", poly: blob(25, 12.5, 2.4, 1.6, 11, 0.1, 18) },
    boost(44, 23.5, 0, 1),
    ramp(44, 28.5, 0, 1),
    boost(83, 66, 0, -1),
    boost(83, 58, 0, -1),
    boost(83, 50, 0, -1),
    boost(83.5, 40, 0, -1),
    boost(84, 46, 1, 0),
    ramp(88.5, 46, 1, 0, 0.55),
    { kind: "wind", poly: rect(37, 30, 22, 19), dir: v(1, 0), strength: 9 },
    { kind: "wind", poly: rect(87.5, 38, 7, 16), dir: v(0, 1), strength: 10 },
    boost(36, 66, -1, 0),
    boost(60, 66, 1, 0),
  ],
  walls: [rail(37.5, 38.1, 58.5, 38.1), rail(37.5, 41.9, 58.5, 41.9), rail(37, 73, 59, 73), isletRail()],
  blocks: [],
  props: [],
  bumpers: [
    bump(15.5, 20.5),
    bump(24.5, 21),
    bump(20, 24.5),
    bump(14, 27.5, 0.7),
    bump(27, 27, 0.7),
    bump(20.5, 31),
    bump(30, 16, 0.7),
    bump(16.5, 14.5, 0.7),
    bump(41.5, 58.5, 0.7),
    bump(54.5, 58.5, 0.7),
    bump(21.5, 54.5, 0.7),
    bump(14.5, 60.5, 0.7),
    bump(23.5, 38.5, 0.7),
    bump(28.5, 40.5, 0.7),
    bump(96.5, 43, 0.6),
  ],
  movers: [
    { kind: "spinner", at: v(71, 50), L: 3.2, arms: 2, omega: 1.5, w: 0.55 },
    { kind: "slider", a: v(40.5, 40), b: v(55.5, 40), size: v(1.6, 2.9), period: 7 },
  ],
  portals: [{ a: v(14.5, 66), b: v(84, 30.5) }],
  wells: [],
  lamps: [],
  boxes: [
    v(36, 55),
    v(60, 55),
    v(48, 51.5),
    v(30, 40),
    v(66, 40),
    v(48, 26),
    v(20, 36),
    v(36, 15),
    v(58, 15),
    v(70, 22.5),
    v(79, 26),
    v(66, 30),
    v(12, 37),
    v(101, 49),
  ],
  mines: [v(66, 16.5), v(70, 19), v(74, 15.5), v(78, 21), v(68, 26.5), v(75, 28), v(82, 19), v(63.5, 22), v(72, 31), v(76, 24.5)],
};

export const SANDBOX_SPAWNS = [SANDBOX.tee, ...(SANDBOX.tees ?? [])];
