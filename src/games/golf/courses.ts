import { rng, v, type Course, type Ground, type PropKind, type Theme, type Vec, type Zone } from "./engine";
import { P, archRect, blob, circle, polyDist, rect, ribbon, rrect, scatter } from "./shapes";

// Sixteen maps: three for each of four themes (two holes and an open world), then four wild cards. Each
// one is the signature hole of a course; a full course is nine holes in the same style.

export const THEMES: { id: Theme; name: string }[] = [
  { id: "hills", name: "Green Hills" },
  { id: "desert", name: "Desert" },
  { id: "ice", name: "Ice" },
  { id: "volcano", name: "Volcano" },
  { id: "arcade", name: "Neon Arcade" },
  { id: "orbit", name: "Low Orbit" },
  { id: "server", name: "Server Room" },
  { id: "zen", name: "Koi Garden" },
];

type Draft = Partial<Course> & Pick<Course, "id" | "name" | "course" | "theme" | "par" | "tee" | "cup" | "greens">;

const N = (x: number, y: number): Vec => {
  const l = Math.hypot(x, y);
  return v(x / l, y / l);
};
const mound = (x: number, y: number, r: number, strength: number): Zone => ({ kind: "mound", poly: circle(x, y, r, 28), center: v(x, y), radius: r, strength });
const slope = (poly: Vec[], dx: number, dy: number, strength: number): Zone => ({ kind: "slope", poly, dir: N(dx, dy), strength });
const ramp = (poly: Vec[], dx: number, dy: number, lift: number): Zone => ({ kind: "ramp", poly, dir: N(dx, dy), lift });
const ground = (kind: Ground, poly: Vec[]): Zone => ({ kind, poly });

// What grows around each theme's holes, and what stands in the rough of its open world.
const DRESS: Record<Theme, { decor: [PropKind, number, number, number][]; solid: [PropKind, number, number][] }> = {
  hills: { decor: [["tree", 0.9, 1.6, 4], ["bush", 0.5, 0.8, 1], ["flowers", 0.5, 0.8, 0], ["tuft", 0.3, 0.5, 0]], solid: [["tree", 1.1, 4.2], ["bush", 0.6, 1.2]] },
  desert: { decor: [["cactus", 0.4, 0.6, 2.2], ["rock", 0.4, 0.9, 1], ["skull", 0.3, 0.4, 0.2], ["tuft", 0.3, 0.5, 0]], solid: [["cactus", 0.45, 2.4], ["rock", 0.7, 1.2]] },
  ice: { decor: [["pine", 0.9, 1.5, 5], ["rock", 0.4, 0.8, 1], ["snowman", 0.5, 0.6, 1.6]], solid: [["pine", 1.0, 5], ["rock", 0.7, 1.2]] },
  volcano: { decor: [["rock", 0.5, 1.0, 1.2], ["vent", 0.4, 0.6, 0], ["crystal", 0.5, 0.8, 1.5]], solid: [["crystal", 0.55, 1.6], ["rock", 0.8, 1.4]] },
  arcade: { decor: [], solid: [] },
  orbit: { decor: [["asteroid", 0.3, 1.1, 0]], solid: [] },
  server: { decor: [], solid: [] },
  zen: { decor: [["cherry", 1.2, 1.8, 4], ["maple", 1.0, 1.5, 4], ["fern", 0.4, 0.7, 0.6], ["rock", 0.4, 0.8, 1]], solid: [] },
};
const LAMP: Record<Theme, PropKind> = { hills: "lamp", desert: "lamp", ice: "lamp", volcano: "lamp", arcade: "lamp", orbit: "beacon", server: "lamp", zen: "lantern" };

function build(d: Draft, i: number): Course {
  const c: Course = {
    w: 22,
    h: 36,
    off: "rough",
    zones: [],
    walls: [],
    blocks: [],
    props: [],
    bumpers: [],
    movers: [],
    portals: [],
    wells: [],
    lamps: [],
    boxes: [],
    ...d,
  };
  const r = rng(1000 + i * 17);
  for (const at of c.lamps) c.props.push({ kind: LAMP[c.theme], at, r: 0.3, h: 2.6 });
  const dress = DRESS[c.theme];
  const taken = (p: Vec, pad: number) =>
    c.greens.some((g) => polyDist(p, g.poly) < pad) ||
    c.zones.some((z) => z.kind !== "mound" && polyDist(p, z.poly) < pad * 0.7) ||
    c.blocks.some((b) => polyDist(p, b.poly) < pad * 0.8) ||
    c.props.some((q) => Math.hypot(q.at.x - p.x, q.at.y - p.y) < q.r + pad) ||
    Math.hypot(p.x - c.tee.x, p.y - c.tee.y) < 4 ||
    Math.hypot(p.x - c.cup.x, p.y - c.cup.y) < 4;
  // Open worlds: things to play around in the rough.
  if (c.open && dress.solid.length) {
    for (const p of scatter(i * 31 + 7, Math.round(c.w * c.h * 0.03), [1, 1, c.w - 2, c.h - 2], 2.2, (p) => taken(p, 1.6))) {
      const [kind, size, h] = dress.solid[r() < 0.8 ? 0 : 1];
      c.props.push({ kind, at: p, r: size * (0.85 + r() * 0.4), h, solid: true, seed: Math.floor(r() * 1e6) });
    }
  }
  // Scenery around the edges.
  if (dress.decor.length) {
    const M = c.open ? 6 : 10;
    const area: [number, number, number, number] = [-M, -M, c.w + M * 2, c.h + M * 2];
    for (const p of scatter(i * 53 + 3, Math.round((c.w + 20) * (c.h + 20) * (c.open ? 0.02 : 0.05)), area, 0.9, (p) => taken(p, 0.7))) {
      const [kind, r0, r1, h] = dress.decor[Math.floor(r() * r() * dress.decor.length)];
      c.props.push({ kind, at: p, r: r0 + r() * (r1 - r0), h, seed: Math.floor(r() * 1e6) });
    }
  }
  return c;
}

const DRAFTS: Draft[] = [
  // ---------------------------------------------------------------- Green Hills
  {
    id: "windmill",
    name: "The Windmill",
    course: "Meadow Run",
    theme: "hills",
    par: 3,
    tee: v(11, 30.2),
    cup: v(11, 6.5),
    greens: [{ poly: P(5, 33, 17, 33, 17, 23, 18.5, 21.5, 18.5, 5.5, 16.5, 3.5, 5.5, 3.5, 3.5, 5.5, 3.5, 21.5, 5, 23) }],
    zones: [
      ground("water", blob(6.4, 25.6, 1.5, 2.3, 1)),
      ground("water", blob(15.9, 8.7, 1.4, 1.8, 2)),
      ground("sand", blob(13.5, 5.5, 1.4, 0.85, 3)),
      slope(rect(3.5, 9, 15, 1.9), 0, 1, 2.4),
      ramp(rect(15.4, 16.4, 2.4, 2.6), 0, -1, 0.72),
    ],
    walls: [
      { pts: P(3.5, 13.1, 8.2, 13.1), w: 0.9, h: 0.9, style: "stone" },
      { pts: P(13.8, 13.1, 18.5, 13.1), w: 0.9, h: 0.9, style: "stone" },
    ],
    blocks: [
      { poly: rect(8.2, 11, 1.4, 4.2), h: 3.2, style: "mill" },
      { poly: rect(12.4, 11, 1.4, 4.2), h: 3.2, style: "mill" },
      { poly: rect(8, 10.8, 6, 4.6), h: 3.6, style: "roof", roof: true },
    ],
    movers: [{ kind: "windmill", hub: v(11, 15.7), L: 2.9, arms: 4, omega: 1.3, mouth: [v(9.6, 15.4), v(12.4, 15.4)], height: 2.7 }],
    lamps: [v(2.3, 22.4), v(19.7, 22.4), v(2.3, 8), v(19.7, 13.6)],
    boxes: [v(16.7, 20.6), v(5.6, 9.9)],
  },
  {
    id: "topiary",
    name: "Topiary",
    course: "Hedge Maze",
    theme: "hills",
    par: 3,
    tee: v(5.5, 30.5),
    cup: v(16.3, 6.2),
    greens: [{ poly: rrect(2.5, 2.5, 17, 31, 1.2) }],
    zones: [
      slope(rect(3.2, 3.2, 8.6, 7.2), 1, 0, 2.2),
      ground("sand", blob(12.6, 5.9, 1.5, 1.1, 4)),
      mound(6, 21.6, 2.6, 3.2),
      ramp(rect(10, 19.6, 2.6, 2.6), 0, -1, 0.72),
    ],
    walls: [
      { pts: P(2.5, 25, 14, 25), w: 1.1, h: 1.3, style: "hedge" },
      { pts: P(8, 18, 19.5, 18), w: 1.1, h: 1.3, style: "hedge" },
      { pts: P(2.5, 11, 14, 11), w: 1.1, h: 1.3, style: "hedge" },
    ],
    props: [
      { kind: "bush", at: v(11, 14.5), r: 1.1, h: 1.7, solid: true, seed: 3 },
      { kind: "bush", at: v(16.6, 28.6), r: 0.9, h: 1.5, solid: true, seed: 8 },
    ],
    lamps: [v(1.2, 18), v(20.8, 25), v(20.8, 11)],
    boxes: [v(4.8, 14.5), v(17.4, 21.5)],
  },
  {
    id: "highlands",
    name: "Highlands",
    course: "Highlands",
    theme: "hills",
    par: 6,
    open: true,
    w: 48,
    h: 100,
    tee: v(24, 94),
    cup: v(24, 8),
    greens: [{ poly: ribbon([[24, 97, 4], [24, 94, 4.5], [22, 84, 5], [15, 74, 5.5], [13, 64, 5], [17, 54, 4.5], [24, 46, 4], [32, 38, 5], [34, 28, 5], [29, 18, 5.5], [24, 10, 6], [23, 4, 4]]), rim: false }],
    zones: [
      ground("fringe", ribbon([[24, 97, 4], [24, 94, 4.5], [22, 84, 5], [15, 74, 5.5], [13, 64, 5], [17, 54, 4.5], [24, 46, 4], [32, 38, 5], [34, 28, 5], [29, 18, 5.5], [24, 10, 6], [23, 4, 4]])),
      ground("green", blob(24, 8, 5.4, 4.8, 9, 0.06)),
      ground("water", blob(31, 66, 6.5, 8.5, 5)),
      ground("water", ribbon([[-1, 52, 1.3], [10, 50, 1.4], [20, 53, 1.5], [30, 49, 1.4], [40, 51, 1.3], [49, 49, 1.3]])),
      ground("bridge", rect(14.5, 49, 6, 6)),
      ground("sand", blob(29, 22, 2.6, 1.6, 6)),
      ground("sand", blob(19.5, 13, 2, 1.4, 7)),
      ground("sand", blob(28, 40, 2.2, 1.3, 8)),
      ground("sand", blob(20, 86, 1.8, 1.2, 10)),
      mound(13.5, 63, 4.5, 3.2),
      mound(37, 30, 5, 3),
      mound(24, 8, 5, -1.4),
      ramp(rect(21, 80, 3, 2.6), 0, -1, 0.6),
    ],
    walls: [
      { pts: P(14.5, 49, 14.5, 55), w: 0.35, h: 0.7, style: "rail" },
      { pts: P(20.5, 49, 20.5, 55), w: 0.35, h: 0.7, style: "rail" },
    ],
    lamps: [v(18.3, 88), v(9.5, 70), v(21.5, 47.5), v(38.5, 36), v(31, 12), v(17.5, 7)],
    boxes: [v(35.5, 31), v(9.6, 64), v(17.5, 52), v(28.5, 13)],
  },
  // ---------------------------------------------------------------- Desert
  {
    id: "switchback",
    name: "Switchback",
    course: "Mesa Trail",
    theme: "desert",
    par: 4,
    off: "dune",
    tee: v(5, 30),
    cup: v(16.5, 6),
    greens: [{ poly: P(3, 3, 19, 3, 19, 9, 9, 9, 9, 14, 19, 14, 19, 33, 3, 33, 3, 27, 13, 27, 13, 20, 3, 20) }],
    zones: [
      slope(rect(3, 27, 16, 6), 1, 0, 1.6),
      slope(rect(13, 20, 6, 7), 0, 1, 3.2),
      slope(rect(3, 14, 16, 6), -1, 0, 1.8),
      slope(rect(3, 9, 6, 5), 0, 1, 3.2),
      ground("quicksand", blob(10.5, 17, 1.5, 1.3, 11)),
      ground("quicksand", blob(16.6, 30.4, 1.3, 1.1, 12)),
      ground("sand", blob(13, 6.2, 1.4, 1.0, 13)),
    ],
    blocks: [
      { poly: rrect(9.6, 9.6, 9.6, 3.8, 1), h: 4.5, style: "mesa" },
      { poly: rrect(2.8, 20.6, 9.6, 5.8, 1.2), h: 4.5, style: "mesa" },
      { poly: blob(20.8, 18, 1.1, 3.5, 14), h: 3.5, style: "mesa" },
    ],
    props: [
      { kind: "cactus", at: v(7.8, 29.4), r: 0.45, h: 2.2, solid: true, seed: 1 },
      { kind: "cactus", at: v(15.2, 16.2), r: 0.45, h: 2.2, solid: true, seed: 2 },
      { kind: "cactus", at: v(11.2, 4.8), r: 0.4, h: 2, solid: true, seed: 3 },
    ],
    lamps: [v(1.8, 30), v(20.2, 24), v(1.8, 16.5), v(1.8, 6), v(20.2, 6)],
    boxes: [v(17.2, 23.6), v(5.2, 11.5)],
  },
  {
    id: "oasis",
    name: "Oasis",
    course: "Oasis",
    theme: "desert",
    par: 3,
    off: "dune",
    tee: v(11, 31),
    cup: v(11, 5.8),
    greens: [{ poly: rrect(2.5, 2.5, 17, 31, 4) }],
    zones: [
      ground("sand", blob(11, 17, 6.4, 7.6, 15, 0.07)),
      ground("water", blob(11, 17, 5.4, 6.6, 15, 0.07)),
      ramp(rect(9.8, 25.4, 2.4, 2.4), 0, -1, 0.7),
      mound(11, 5.8, 3, -1.2),
    ],
    props: [
      { kind: "palm", at: v(5.6, 12.4), r: 0.35, h: 4.5, solid: true, seed: 1 },
      { kind: "palm", at: v(16.4, 12.1), r: 0.35, h: 4.5, solid: true, seed: 2 },
      { kind: "palm", at: v(5.5, 21.6), r: 0.35, h: 4.5, solid: true, seed: 3 },
      { kind: "palm", at: v(16.6, 21.9), r: 0.35, h: 4.5, solid: true, seed: 4 },
    ],
    lamps: [v(1.6, 24), v(20.4, 24), v(1.6, 10), v(20.4, 10)],
    boxes: [v(3.7, 17), v(18.3, 17)],
  },
  {
    id: "dunesea",
    name: "Dune Sea",
    course: "Dune Sea",
    theme: "desert",
    par: 7,
    open: true,
    off: "dune",
    w: 48,
    h: 100,
    tee: v(24, 94),
    cup: v(24, 8),
    greens: [{ poly: ribbon([[24, 97, 4], [24, 94, 4.5], [30, 84, 4.5], [36, 72, 4], [37, 62, 3], [37, 52, 3], [31, 42, 4], [21, 34, 4.5], [14, 24, 4], [19, 14, 5], [24, 8, 5.5], [25, 4, 4]]), rim: false }],
    zones: [
      ground("void", ribbon([[-1, 56, 3.2], [12, 55, 3.6], [24, 57, 3.4], [36, 55, 3.2], [49, 57, 3]])),
      ground("stone", rect(34.6, 51, 4.8, 8.8)),
      ground("stone", rect(10, 50.6, 4, 9.2)),
      ground("quicksand", blob(30.5, 41, 1.8, 1.4, 16)),
      ground("quicksand", blob(12, 80, 2.4, 1.8, 17)),
      ground("quicksand", blob(20, 30, 1.6, 1.2, 18)),
      ground("sand", blob(33, 9.5, 3.4, 2.8, 19)),
      ground("water", blob(33, 9.5, 2.6, 2, 19)),
      mound(10, 88, 6, 3),
      mound(40, 90, 5, 3),
      mound(8, 70, 6, 3.5),
      mound(42, 30, 6, 3),
      mound(6, 40, 5, 3),
      mound(35, 17, 5, 2.6),
    ],
    walls: [
      { pts: P(34.6, 51, 34.6, 59.8), w: 0.4, h: 0.8, style: "adobe" },
      { pts: P(39.4, 51, 39.4, 59.8), w: 0.4, h: 0.8, style: "adobe" },
      { pts: P(10, 50.6, 10, 59.8), w: 0.4, h: 0.8, style: "adobe" },
      { pts: P(14, 50.6, 14, 59.8), w: 0.4, h: 0.8, style: "adobe" },
    ],
    blocks: [
      { poly: blob(8, 30, 4, 3, 20), h: 5, style: "mesa" },
      { poly: blob(41, 22, 3.5, 4, 21), h: 5, style: "mesa" },
      { poly: blob(44, 74, 3, 4, 22), h: 5, style: "mesa" },
      { poly: blob(22, 66, 3, 3, 23), h: 5, style: "mesa" },
      { poly: blob(12, 44, 3, 2.4, 24), h: 4, style: "mesa" },
    ],
    lamps: [v(19, 92), v(34.5, 80), v(33, 49), v(41, 62), v(26, 37), v(9.5, 22), v(30, 5)],
    boxes: [v(12, 55), v(42, 42), v(36, 73), v(28, 88)],
  },
  // ---------------------------------------------------------------- Ice
  {
    id: "rink",
    name: "The Rink",
    course: "Frostbite",
    theme: "ice",
    par: 3,
    off: "snow",
    tee: v(11, 31.6),
    cup: v(11, 6.2),
    greens: [{ poly: rrect(2.5, 2.5, 17, 31, 5) }],
    zones: [
      ground("ice", rrect(3.4, 9, 15.2, 21.5, 4)),
      ground("snow", blob(15, 13.5, 1.4, 1.1, 25)),
      ground("snow", blob(6.2, 22, 1.3, 1, 26)),
      slope(rect(3.4, 10, 1.4, 19.5), 1, 0, 3.5),
      slope(rect(17.2, 10, 1.4, 19.5), -1, 0, 3.5),
    ],
    walls: [{ pts: P(8.6, 8.2, 8.6, 4.2, 13.4, 4.2, 13.4, 8.2), w: 0.5, h: 0.9, style: "ice" }],
    bumpers: [
      { at: v(7.2, 16.2), r: 0.9, kick: 2 },
      { at: v(14.8, 20.5), r: 0.9, kick: 2 },
      { at: v(11, 25), r: 0.7, kick: 2 },
    ],
    lamps: [v(1.3, 9), v(20.7, 9), v(1.3, 27), v(20.7, 27)],
    boxes: [v(5, 12.6), v(17, 27)],
  },
  {
    id: "avalanche",
    name: "Avalanche",
    course: "Avalanche",
    theme: "ice",
    par: 3,
    off: "snow",
    tee: v(11, 5.6),
    cup: v(11, 30.6),
    greens: [{ poly: P(4, 3, 18, 3, 18, 12, 19.5, 14, 19.5, 33, 2.5, 33, 2.5, 14, 4, 12) }],
    zones: [
      slope(rect(2.5, 9, 17, 17), 0, 1, 4.2),
      ground("ice", blob(8, 15.5, 2.4, 1.8, 27)),
      ground("ice", blob(14.2, 21.5, 2.4, 1.8, 28)),
      ground("snow", rect(2.5, 26, 17, 2.2)),
      ground("void", blob(5.6, 30.4, 1.3, 1.1, 29)),
      ground("void", blob(16.4, 30.4, 1.3, 1.1, 30)),
    ],
    movers: [
      { kind: "slider", a: v(5, 13), b: v(17, 13), size: v(3.2, 1.1), period: 3.4 },
      { kind: "slider", a: v(17, 22.4), b: v(5, 22.4), size: v(3.2, 1.1), period: 4.2, phase: 0.3 },
    ],
    lamps: [v(1.2, 6), v(20.8, 6), v(1.2, 20), v(20.8, 20), v(1.2, 31), v(20.8, 31)],
    boxes: [v(4.6, 18.5), v(17.4, 10.5)],
  },
  {
    id: "glacier",
    name: "Glacier",
    course: "Glacier",
    theme: "ice",
    par: 7,
    open: true,
    off: "snow",
    w: 48,
    h: 100,
    tee: v(24, 94),
    cup: v(24, 9),
    greens: [{ poly: ribbon([[24, 97, 4], [24, 94, 4.5], [16, 84, 4.5], [12, 72, 4], [16, 60, 4], [26, 52, 4.5], [34, 42, 4], [34, 30, 4], [26, 20, 4.5], [24, 9, 5], [24, 4, 4]]), rim: false }],
    zones: [
      ground("ice", blob(32, 74, 8.5, 7.5, 31)),
      ground("void", ribbon([[-1, 46, 1.3], [8, 44, 1.6], [16, 46.5, 1.4], [21, 45.5, 0.6]])),
      ground("void", ribbon([[49, 25, 1.3], [42, 26.5, 1.6], [37.5, 25, 0.6]])),
      ground("ice", blob(14, 64, 2, 1.5, 32)),
      ground("ice", blob(30.5, 36, 2, 1.4, 33)),
      ramp(rect(12.5, 49, 3, 2.6), 0, -1, 0.6),
      mound(8, 90, 5, 3),
      mound(40, 88, 5, 3),
      mound(40, 58, 5, 3),
      mound(8, 30, 5, 3),
      mound(41, 12, 4, 3),
      mound(24, 9, 4, -1.2),
    ],
    blocks: [
      { poly: rect(3, 56, 5, 4), h: 3, style: "cabin" },
      { poly: rect(39, 38, 5, 4), h: 3, style: "cabin" },
      { poly: blob(12, 30, 2.4, 1.8, 34), h: 2.4, style: "ice" },
      { poly: blob(38, 66, 1.6, 1.4, 35), h: 2, style: "ice" },
    ],
    lamps: [v(9, 61), v(41.5, 43), v(20, 90), v(9.5, 72), v(29.5, 30), v(29, 8)],
    boxes: [v(32, 74), v(8, 40), v(41, 15), v(26, 52)],
  },
  // ---------------------------------------------------------------- Volcano
  {
    id: "lavalamp",
    name: "Lava Lamp",
    course: "Caldera",
    theme: "volcano",
    par: 4,
    tee: v(11, 31),
    cup: v(11, 6),
    greens: [{ poly: rrect(2.5, 2.5, 17, 31, 2) }],
    zones: [
      ground("lava", ribbon([[1, 24, 1.4], [6, 25, 1.5], [11, 23.5, 1.6], [16, 24.8, 1.5], [21, 23.8, 1.4]])),
      ground("stone", rect(4.4, 21.4, 2.6, 5.6)),
      ramp(rect(9.8, 27.2, 2.4, 2.2), 0, -1, 0.65),
      ground("lava", ribbon([[1, 13.5, 1.3], [6, 12.6, 1.4], [11, 14, 1.5], [16, 12.8, 1.5], [21, 13.6, 1.3]])),
      ground("stone", rect(14.6, 10.3, 2.6, 5.8)),
      mound(11, 6, 3, -1),
    ],
    walls: [
      { pts: P(4.4, 21.4, 4.4, 27), w: 0.4, h: 0.7, style: "obsidian" },
      { pts: P(7, 21.4, 7, 27), w: 0.4, h: 0.7, style: "obsidian" },
      { pts: P(14.6, 10.3, 14.6, 16.1), w: 0.4, h: 0.7, style: "obsidian" },
      { pts: P(17.2, 10.3, 17.2, 16.1), w: 0.4, h: 0.7, style: "obsidian" },
    ],
    blocks: [
      { poly: blob(11.2, 18.8, 1.2, 1, 36), h: 2.5, style: "pillar" },
      { poly: blob(6.2, 7, 0.9, 0.8, 37), h: 2.2, style: "pillar" },
    ],
    props: [{ kind: "crystal", at: v(15.6, 29.8), r: 0.5, h: 1.4, solid: true, seed: 4 }],
    lamps: [v(1.6, 18.5), v(20.4, 18.5), v(1.6, 30), v(20.4, 30), v(1.6, 6), v(20.4, 6)],
    boxes: [v(17.5, 18.6), v(4.6, 17.4)],
  },
  {
    id: "magmaworks",
    name: "Magma Works",
    course: "Magma Works",
    theme: "volcano",
    par: 3,
    tee: v(11, 31),
    cup: v(11, 6),
    greens: [{ poly: rrect(2.5, 2.5, 17, 31, 1) }],
    zones: [
      { kind: "conveyor", poly: rect(4.5, 21.6, 15, 2.4), dir: v(-1, 0), speed: 6 },
      ground("lava", rect(2.5, 21.3, 2, 3)),
      { kind: "conveyor", poly: rect(2.5, 14.6, 15, 2.4), dir: v(1, 0), speed: 6 },
      ground("lava", rect(17.5, 14.3, 2, 3)),
      { kind: "boost", poly: rect(9.8, 26.4, 2.4, 2.6), dir: v(0, -1), strength: 45 },
    ],
    walls: [
      { pts: P(6.6, 11.2, 8.8, 8.8), w: 0.5, h: 0.8, style: "metal" },
      { pts: P(15.4, 11.2, 13.2, 8.8), w: 0.5, h: 0.8, style: "metal" },
    ],
    bumpers: [
      { at: v(5.6, 7.6), r: 0.8, kick: 3 },
      { at: v(16.4, 7.6), r: 0.8, kick: 3 },
    ],
    movers: [{ kind: "spinner", at: v(11, 19.3), L: 2.4, arms: 2, omega: 1.1, w: 0.5 }],
    lamps: [v(1.4, 10), v(20.6, 10), v(1.4, 27), v(20.6, 27)],
    boxes: [v(17.6, 19.3), v(4.4, 19.3)],
  },
  {
    id: "ashlands",
    name: "Ashlands",
    course: "Ashlands",
    theme: "volcano",
    par: 7,
    open: true,
    w: 48,
    h: 100,
    tee: v(24, 94),
    cup: v(26, 9),
    greens: [{ poly: ribbon([[24, 97, 3.6], [24, 95, 4], [32, 84, 4], [34, 72, 3.5], [26, 62, 4], [16, 54, 4], [12, 42, 3.5], [18, 30, 4], [30, 22, 4], [26, 10, 5], [25, 4, 4]]), rim: false }],
    zones: [
      ground("lava", blob(14, 80, 6, 5, 38)),
      ground("lava", blob(37, 46, 6, 7, 39)),
      ground("lava", ribbon([[-1, 66, 1.5], [12, 67, 1.6], [24, 64.5, 1.5], [36, 66, 1.5], [49, 63, 1.5]])),
      ground("stone", rect(26.5, 61.5, 6, 6.6)),
      ground("lava", blob(22.5, 36, 1.8, 1.4, 40)),
      ground("lava", blob(36, 15, 2.4, 2, 41)),
      mound(26, 9, 4, -1.2),
      mound(8, 88, 5, 2.5),
      mound(40, 30, 5, 2.5),
    ],
    walls: [
      { pts: P(26.5, 61.5, 26.5, 68.1), w: 0.4, h: 0.7, style: "obsidian" },
      { pts: P(32.5, 61.5, 32.5, 68.1), w: 0.4, h: 0.7, style: "obsidian" },
    ],
    blocks: [
      { poly: blob(6, 56, 2, 1.6, 42), h: 4, style: "pillar" },
      { poly: blob(42, 86, 2.2, 1.8, 43), h: 4, style: "pillar" },
      { poly: blob(22, 48, 1.6, 1.4, 44), h: 3.5, style: "pillar" },
      { poly: blob(40, 6, 2, 1.6, 45), h: 3.5, style: "pillar" },
      { poly: blob(6, 22, 2.2, 1.8, 46), h: 4, style: "pillar" },
    ],
    lamps: [v(19.5, 92), v(37, 80), v(22, 57), v(7.8, 40), v(34, 25), v(20, 8)],
    boxes: [v(24, 41), v(40, 30), v(8, 61), v(30, 89)],
  },
  // ---------------------------------------------------------------- Wild cards
  {
    id: "tilt",
    name: "Tilt",
    course: "Neon Arcade",
    theme: "arcade",
    par: 3,
    tee: v(18, 31.2),
    cup: v(11, 5.6),
    greens: [{ poly: archRect(2.5, 2.5, 17, 31, 6) }],
    zones: [
      ground("void", rect(7.2, 30.4, 4.8, 3.2)),
      { kind: "boost", poly: rect(16.9, 20, 2.4, 5), dir: v(0, -1), strength: 55 },
      { kind: "boost", poly: rect(3, 12, 1.6, 5), dir: v(0, -1), strength: 35 },
    ],
    walls: [
      { pts: P(16.6, 33.3, 16.6, 13), w: 0.4, h: 0.8, style: "neon" },
      { pts: P(4.4, 24, 6.8, 27.6), w: 0.4, h: 0.8, style: "neon", bounce: 1.25 },
      { pts: P(14.7, 24, 12.3, 27.6), w: 0.4, h: 0.8, style: "neon", bounce: 1.25 },
      { pts: P(8.7, 4, 8.7, 7.6), w: 0.4, h: 0.8, style: "neon" },
      { pts: P(13.3, 4, 13.3, 7.6), w: 0.4, h: 0.8, style: "neon" },
    ],
    bumpers: [
      { at: v(7.4, 12.6), r: 1, kick: 7 },
      { at: v(12.6, 12.6), r: 1, kick: 7 },
      { at: v(10, 16.6), r: 1, kick: 7 },
      { at: v(5.6, 19.5), r: 0.6, kick: 5 },
      { at: v(13.6, 19.5), r: 0.6, kick: 5 },
    ],
    boxes: [v(5, 8.5), v(10, 22.4)],
  },
  {
    id: "horizon",
    name: "Event Horizon",
    course: "Low Orbit",
    theme: "orbit",
    par: 3,
    off: "void",
    tee: v(11, 32.2),
    cup: v(12.6, 5.4),
    greens: [
      { poly: blob(11, 30.4, 4.4, 3.8, 47, 0.1), rim: false },
      { poly: blob(5, 19, 2.5, 2.4, 48, 0.1), rim: false },
      { poly: blob(17, 17, 2.5, 2.4, 49, 0.1), rim: false },
      { poly: blob(11.5, 6, 4.4, 3.4, 50, 0.1), rim: false },
      { poly: ribbon([[9.8, 28, 0.75], [7, 23.5, 0.7], [5.4, 20.5, 0.7]]), rim: false },
    ],
    zones: [ramp(rect(9.8, 27.6, 2.4, 1.8), 0, -1, 0.75)],
    wells: [{ at: v(11, 18.4), r: 7.5, strength: 22 }],
    portals: [{ a: v(4.6, 19.2), b: v(8.6, 7.4) }],
    lamps: [v(7.6, 33.2), v(14.4, 33.2), v(8.6, 3.8), v(15.4, 7.6)],
    boxes: [v(17, 17), v(7.2, 23.7)],
  },
  {
    id: "hotpath",
    name: "Hot Path",
    course: "Server Room",
    theme: "server",
    par: 3,
    tee: v(11, 31.4),
    cup: v(11, 5.6),
    greens: [{ poly: rrect(2.5, 2.5, 17, 31, 0.8) }],
    zones: [
      { kind: "conveyor", poly: rect(3, 24.2, 16, 1.8), dir: v(1, 0), speed: 5 },
      { kind: "conveyor", poly: rect(3, 15.6, 16, 1.8), dir: v(-1, 0), speed: 5 },
      ground("coolant", blob(16.4, 8.4, 1.6, 1.1, 51)),
    ],
    blocks: [
      { poly: rect(2.5, 19.8, 7, 2.2), h: 2.6, style: "rack" },
      { poly: rect(12.5, 19.8, 7, 2.2), h: 2.6, style: "rack" },
      { poly: rect(6.2, 11.8, 13.3, 2.2), h: 2.6, style: "rack" },
      { poly: rect(0.3, 3, 1.6, 30), h: 2.6, style: "rack" },
      { poly: rect(20.1, 3, 1.6, 30), h: 2.6, style: "rack" },
    ],
    portals: [{ a: v(17.4, 28.4), b: v(4.4, 9.6) }],
    lamps: [v(11, 1.3), v(11, 34.7)],
    boxes: [v(11, 18.6), v(4, 5)],
  },
  {
    id: "koipond",
    name: "Koi Pond",
    course: "Koi Garden",
    theme: "zen",
    par: 3,
    tee: v(11, 31.4),
    cup: v(11, 6.2),
    greens: [{ poly: rrect(2.5, 2.5, 17, 31, 5) }],
    zones: [
      ground("water", blob(11, 18, 6.9, 4.4, 52, 0.07)),
      ground("bridge", rect(9.7, 12.6, 2.6, 10.8)),
      slope(rect(9.7, 18, 2.6, 5.4), 0, 1, 3.2),
      slope(rect(9.7, 12.6, 2.6, 5.4), 0, -1, 3.2),
      ground("stone", circle(6.2, 16.4, 0.7, 14)),
      ground("stone", circle(7.6, 19.2, 0.65, 14)),
      ground("stone", circle(6, 21.2, 0.6, 14)),
      ground("stone", circle(15.6, 16.8, 0.7, 14)),
      ground("stone", circle(14.6, 19.8, 0.6, 14)),
      ground("sand", rrect(4.4, 24.6, 13.2, 4.6, 2)),
    ],
    walls: [
      { pts: P(9.7, 12.6, 9.7, 23.4), w: 0.35, h: 0.8, style: "timber" },
      { pts: P(12.3, 12.6, 12.3, 23.4), w: 0.35, h: 0.8, style: "timber" },
    ],
    props: [
      { kind: "rock", at: v(8.2, 26.8), r: 0.8, h: 1.1, solid: true, seed: 5 },
      { kind: "rock", at: v(14.2, 27.2), r: 0.6, h: 0.9, solid: true, seed: 6 },
    ],
    lamps: [v(1.3, 11.5), v(20.7, 11.5), v(1.3, 24.4), v(20.7, 24.4)],
    boxes: [v(3.3, 18), v(18.7, 18)],
  },
];

export const COURSES: Course[] = DRAFTS.map(build);
export const courseById = (id: string) => COURSES.find((c) => c.id === id) ?? COURSES[0];
