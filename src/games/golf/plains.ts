import { v, type Bumper, type Course, type Vec, type Wall } from "./engine";
import { P, rect, rrect } from "./shapes";

// Bumper Plains: six short holes made by hand, each built round bumpers sitting exactly where you'd
// rather they didn't. Plain green boards floating in the void; no scenery.

type Hole = Pick<Course, "id" | "name" | "par" | "tee" | "cup"> & { board: Vec[]; bumpers: [number, number, number?][]; walls?: Wall[]; boxes?: Vec[] };

const bump = (b: [number, number, number?]): Bumper => ({ at: v(b[0], b[1]), r: b[2] ?? 0.85, kick: 5 });
const baffle = (x0: number, y0: number, x1: number, y1: number): Wall => ({ pts: [v(x0, y0), v(x1, y1)], w: 0.5, h: 0.6, style: "wood" });

// A round green on a stem that joins the bottom of the circle.
function lollipop(cx: number, cy: number, r: number, stemHalf: number, stemTo: number): Vec[] {
  const a0 = Math.acos(stemHalf / r); // where the stem's right edge meets the circle
  const sweep = Math.PI * 2 - (Math.PI - 2 * a0);
  const pts: Vec[] = [];
  for (let k = 0; k <= 48; k++) {
    const a = a0 - (sweep * k) / 48;
    pts.push(v(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  const join = cy + Math.sin(a0) * r;
  return [...pts, v(cx - stemHalf, stemTo), v(cx + stemHalf, stemTo), v(cx + stemHalf, join)];
}

const HOLES: Hole[] = [
  {
    // One bumper, dead in the middle of the only line.
    id: "plains-1",
    name: "Hello",
    par: 2,
    tee: v(11, 31),
    cup: v(11, 7),
    board: rrect(7, 3, 8, 32, 1),
    bumpers: [[11, 19, 1.1]],
  },
  {
    // A corner, a bumper on the inside of it, and two guarding the cup.
    id: "plains-2",
    name: "Elbow",
    par: 3,
    tee: v(7, 32),
    cup: v(16.5, 8.5),
    board: P(3, 36, 11, 36, 11, 13, 20, 13, 20, 4, 3, 4),
    bumpers: [[7.5, 10], [14, 6.4, 0.75], [14, 10.6, 0.75], [5.2, 22, 0.8]],
    boxes: [v(18, 11.5)],
  },
  {
    // A pinball table: a triangle of bumpers right across the way up.
    id: "plains-3",
    name: "Tilt",
    par: 3,
    tee: v(11, 32),
    cup: v(11, 6.5),
    board: rrect(2, 3, 18, 32, 4),
    bumpers: [[11, 13], [7.5, 18], [14.5, 18], [11, 23], [4.8, 24, 0.7], [17.2, 24, 0.7], [11, 9.2, 0.6]],
    boxes: [v(4.5, 9), v(17.5, 30)],
  },
  {
    // Three baffles from alternate sides, and a bumper splitting every gap.
    id: "plains-4",
    name: "Chicane",
    par: 4,
    tee: v(11, 33),
    cup: v(7, 5.5),
    board: rect(4, 2, 14, 35),
    walls: [baffle(4, 27, 12, 27), baffle(18, 19, 10, 19), baffle(4, 11, 12, 11)],
    bumpers: [[15, 27, 0.8], [7, 19, 0.8], [15, 11, 0.8]],
    boxes: [v(16, 23)],
  },
  {
    // The cup inside a ring of bumpers whose gap faces away from you.
    id: "plains-5",
    name: "Crown",
    par: 3,
    tee: v(11, 33),
    cup: v(11, 13),
    board: lollipop(11, 13, 9.5, 3, 36),
    bumpers: [0, 45, 90, 135, 180, 225, 315].map((d) => {
      const a = ((d + 90) * Math.PI) / 180;
      return [11 + Math.cos(a) * 4.4, 13 + Math.sin(a) * 4.4, 0.8] as [number, number, number];
    }),
    boxes: [v(4, 9), v(18, 9)],
  },
  {
    // Up, over the top through a field of bumpers, and back down to the cup.
    id: "plains-6",
    name: "Hairpin",
    par: 4,
    tee: v(5.5, 34),
    cup: v(16.5, 33),
    board: P(2, 38, 9, 38, 9, 13, 13, 13, 13, 38, 20, 38, 20, 3, 2, 3),
    bumpers: [[6, 7.5], [11, 5.8], [16, 7.5], [11, 10, 0.7], [16.5, 27, 0.8], [5.5, 20, 0.7]],
    boxes: [v(11, 8)],
  },
];

function build(h: Hole): Course {
  return {
    id: h.id,
    name: h.name,
    course: "Bumper Plains",
    theme: "hills",
    par: h.par,
    w: 22,
    h: 40,
    tee: h.tee,
    cup: h.cup,
    off: "oob",
    greens: [{ poly: h.board }],
    zones: [],
    walls: h.walls ?? [],
    blocks: [],
    props: [],
    bumpers: h.bumpers.map(bump),
    movers: [],
    portals: [],
    wells: [],
    lamps: [],
    boxes: h.boxes ?? [],
  };
}

export const BUMPER_PLAINS: Course[] = HOLES.map(build);
