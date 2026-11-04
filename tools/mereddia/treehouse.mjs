// Lays out the Secret Master's treehouse from the project's own tiles and objects.
//
//   node tools/mereddia/treehouse.mjs
//
// The project has no map for the treehouse, so this builds one: a wooden platform with log walls and corner posts,
// a ladder down to a forest floor, and the furniture, all in the same voxel pieces the other maps use. It writes
// public/mereddia/3d/maps/treehouse.json (what the 3D view draws) and src/games/mereddia/maps/treehouse.grid.ts
// (what the rules walk on). The models it uses are converted by convert.mjs (see the README).

import fs from "node:fs";

const T = 0.8;
const W = 12;
const H = 9;
const FLOOR = 0.05;
const GROUND = -1.6;

// Rotations about the vertical axis, as the project stores them: a 3x3 basis in rows, then the origin.
const ROT = {
  0: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  // The wall pieces sit on a cell's north edge; these turn them to face another way.
  south: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  west: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  east: [0, 0, -1, 0, 1, 0, 1, 0, 0],
};
const at = (cx, cy, y = 0, rot = ROT[0]) => [...rot, cx * T, y, cy * T];
// A cell's centre.
const cell = (x, y) => [(x + 0.5), (y + 0.5)];

const tiles = [];
const objects = [];
const rows = Array.from({ length: H }, () => Array(W).fill("#"));
const open = (x, y) => (rows[y][x] = ".");
const shut = (x, y) => (rows[y][x] = "#");

const tile = (m, cx, cy, y, rot, extra = {}) => tiles.push({ m, x: Math.floor(cx), y: Math.floor(cy), z: 0, t: at(cx, cy, y, rot), ...extra });
const obj = (m, cx, cy, y, rot, extra = {}) => objects.push({ m, x: Math.floor(cx), y: Math.floor(cy), z: 1, t: at(cx, cy, y, rot), ...extra });

// ---- the platform: a thick wooden base with a thin floor on top, interior x 1..10, y 1..6, a landing below the door
const platform = [];
for (let y = 1; y <= 6; y++) for (let x = 1; x <= 10; x++) platform.push([x, y]);
for (let x = 4; x <= 7; x++) platform.push([x, 7]);
for (const [x, y] of platform) {
  const [cx, cy] = cell(x, y);
  tile("wood_floor", cx, cy, -0.8);
  tile("wooden_floor", cx, cy, 0);
}
// Walkable inside the walls, and out through the door onto the landing.
for (let y = 2; y <= 5; y++) for (let x = 2; x <= 9; x++) open(x, y);
for (const x of [5, 6]) open(x, 6);
for (let x = 4; x <= 7; x++) open(x, 7);

// ---- log walls, flush with the inside; corner posts; the south wall has a gap for the door
for (let x = 2; x <= 9; x++) {
  tile("Log_cabin", ...cell(x, 1), 0, ROT.south);
  if (x !== 5 && x !== 6) tile("Log_cabin", ...cell(x, 6), 0, ROT[0]);
}
for (let y = 2; y <= 5; y++) {
  tile("Log_cabin", ...cell(1, y), 0, ROT.east);
  tile("Log_cabin", ...cell(10, y), 0, ROT.west);
}
for (const [x, y] of [[1, 1], [10, 1], [1, 6], [10, 6]]) tile("corner_log", ...cell(x, y), 0, ROT[0]);
// Posts that hold the platform up, standing on the forest floor.
for (const [x, y] of [[1, 1], [10, 1], [1, 6], [10, 6], [5, 7], [4, 7], [7, 7]]) {
  tile("column", ...cell(x, y), GROUND + 0.0, ROT[0]);
  tile("column", ...cell(x, y), GROUND + 1.2, ROT[0]);
}
// A ladder down from the landing.
for (const x of [5, 6]) for (const y of [-0.7, -1.45]) tile("ladder", ...cell(x, 7), y, ROT.south);

// ---- furniture
// The bed along the west wall, two cells long.
obj("bed", 2.5, 3.0, FLOOR, ROT.west);
shut(2, 2);
shut(2, 3);
// Bookcases against the north wall.
for (const x of [4, 5, 6, 7]) {
  obj("bookcase", ...cell(x, 2), FLOOR, ROT[0]);
  shut(x, 2);
}
// A low round table in the middle, with a carpet under it.
for (let y = 3; y <= 4; y++) for (let x = 4; x <= 7; x++) tile("carpet", ...cell(x, y), 0.02, ROT[0]);
obj("ptrn_tradjp_furn_chabudai", 6.0, 4.0, FLOOR, ROT[0]);
for (const [x, y] of [[5, 3], [6, 3], [5, 4], [6, 4]]) shut(x, y);
// The irori: a sunken hearth with a kettle on a chain and a fire.
tile("ptrn_tradjp_stove_irori", ...cell(9, 3), 0.0, ROT[0]);
obj("ptrn_tradjp_AT_irori_fire", ...cell(9, 3), 0.2, ROT[0]);
obj("ptrn_tradjp_AT_irori_chain", ...cell(9, 3), FLOOR, ROT[0]);
obj("ptrn_tradjp_dec_tetsubin", ...cell(9, 3), 0.55, ROT[0]);
shut(9, 3);
// A chest against the east wall, a banner and two lit sconces on the north wall.
obj("ptrn_chest", ...cell(9, 5), FLOOR, ROT.east);
shut(9, 5);
obj("banner", ...cell(8, 2), 0.0, ROT[0]);
for (const x of [3, 9]) obj("sconce", ...cell(x, 2), 0.9, ROT[0]);

// ---- the forest floor far below, and the trees around the treehouse
for (let y = -6; y <= H + 5; y++) for (let x = -7; x <= W + 6; x++) tile("grass", x + 0.5, y + 0.5, GROUND, ROT[0]);
for (const [m, x, y] of [
  ["ptrn_tradjp_tree_blackpine", -2.2, 2.4],
  ["ptrn_tradjp_tree_blackpine", 13.2, 6.2],
  ["ptrn_tradjp_tree_blackpine", -3.4, 7.6],
  ["ptrn_tradjp_tree_dwarfhinokicypress", 13.4, 1.5],
  ["ptrn_tradjp_tree_dwarfhinokicypress", -1.4, -2.2],
  ["ptrn_tree_maple_01", 12.2, -2.6],
  ["ptrn_tree_maple_01", 2.2, 10.6],
  ["ptrn_tradjp_tree_blackpine", 9.2, 11.4],
]) obj(m, x, y, GROUND, ROT[0], { passable: true });

const map = {
  tileWidth: 16,
  music: null,
  player: "Mallakoth_red_2",
  camera: null,
  postLoad: null,
  sky: { top: [0.047, 0.455, 0.977], horizon: [0.557, 0.824, 0.91], ground: [0.102, 0.188, 0.165], groundHorizon: [0.482, 0.953, 0.855], sun: [1, 0.863, 0.502] },
  ambient: [0.78, 0.76, 0.72],
  tiles,
  objects,
  characters: [],
};
fs.writeFileSync("public/mereddia/3d/maps/treehouse.json", JSON.stringify(map));

// ---- the grid the rules use: the Secret Master stands by the table
const grid = { x0: 0, y0: 0, w: W, h: H, rows: rows.map((r) => r.join("")), entities: [{ kind: "characters", m: "Secret Master", x: 7, y: 5, passable: false, dir: "south" }] };
fs.writeFileSync(
  "src/games/mereddia/maps/treehouse.grid.ts",
  `// Generated by tools/mereddia/treehouse.mjs. Do not edit by hand.\nimport type { Grid } from "../world";\n\nexport const grid: Grid = ${JSON.stringify(grid, null, 1)};\n`,
);
console.log(`treehouse: ${tiles.length} tiles, ${objects.length} objects`);
console.log(grid.rows.join("\n"));
