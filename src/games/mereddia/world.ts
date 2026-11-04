// Journey Across Mereddia's world: every area, everyone standing in it, and the numbers behind the
// enemies, weapons, spells and quests. Plain data, no React, so the engine and its tests can use it as it is.
// Arc 0: Mallakoth's road from a field to the Temple of the Sacred Flame, and the trial that follows.

import { grid as slimesGrid } from "./maps/sword_area.grid";
import { grid as fieldGrid } from "./maps/start_area.grid";
import { grid as cavesGrid } from "./maps/Caves.grid";
import { grid as templeGrid } from "./maps/The_Temple.grid";
import { grid as treehouseGrid } from "./maps/treehouse.grid";
import { grid as finaleGrid } from "./maps/The_Temple_Finale.grid";
import { grid as dresdenGrid } from "./maps/Village_I_forgor.grid";
import { grid as spikesGrid } from "./maps/Spike_Trap.grid";

export type Dir = "up" | "down" | "left" | "right";
export type Element = "fire" | "water" | "air" | "earth" | "universal";
export const ELEMENTS: Element[] = ["fire", "water", "air", "earth", "universal"];

export type AreaId = "field" | "caves" | "temple" | "slimes" | "treehouse" | "finale" | "dresden" | "spikes";
export type Theme = "field" | "cave" | "valley" | "temple" | "wood";

// '#' wall, '~' water, '.' floor, '=' bridge, 'w' a waterfall you can walk through.
export type Ground = "#" | "~" | "." | "=" | "w" | "s";
// 's' is a magical spring: water you can wade into, and it heals.
export const WALKABLE: Ground[] = [".", "=", "w", "s"];

export type EntityKind = "npc" | "enemy" | "chest" | "pot" | "gate" | "panel" | "button" | "lever" | "plate" | "pickup" | "crystal" | "exit" | "prop";
export type Spot = { area: AreaId; x: number; y: number };
export type Entity = {
  id: string;
  area: AreaId;
  kind: EntityKind;
  // Which enemy, npc, button, panel or prop this is.
  what: string;
  x: number;
  y: number;
  // A chest that's been opened.
  done?: boolean;
  // A panel that's open (and so can be walked through).
  open?: boolean;
  // An enemy's health when it isn't full any more.
  hp?: number;
  // How many turns an enemy has left frozen.
  frozen?: number;
  // Where an exit leads, and the question asked first.
  to?: Spot;
  ask?: string;
  // The map objects this stands for, as "model@x,y" in the map's own coordinates (joined by |), so the 3D view can hide them.
  src?: string;
  // What a sign says.
  text?: string;
};

// ---------------------------------------------------------------------------------------- enemies

export type SlimeColor = "green" | "blue" | "orange" | "red" | "purple" | "rainbow";
export type EnemyKind = SlimeColor | "bigslime";
export type Ai = { mode: "still" | "wander" | "chase"; every: number; range: number };
export type EnemyDef = { name: string; hp: number; atk: number; def: number; xp: number; gold: number; boss: boolean; taunt: string; ai: Ai };

const wander = (every: number): Ai => ({ mode: "wander", every, range: 0 });
const chase = (every: number, range: number): Ai => ({ mode: "chase", every, range });

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  green: { name: "Green Slime", hp: 10, atk: 4, def: 0, xp: 6, gold: 4, boss: false, taunt: "A green slime wobbles into your path.", ai: wander(2) },
  blue: { name: "Blue Slime", hp: 15, atk: 5, def: 1, xp: 9, gold: 6, boss: false, taunt: "A blue slime blocks the way, cold and glistening.", ai: chase(2, 3) },
  orange: { name: "Orange Slime", hp: 21, atk: 7, def: 1, xp: 14, gold: 9, boss: false, taunt: "An orange slime sizzles toward you.", ai: chase(2, 4) },
  red: { name: "Red Slime", hp: 28, atk: 9, def: 2, xp: 21, gold: 13, boss: false, taunt: "A red slime lunges!", ai: chase(1, 4) },
  purple: { name: "Purple Slime", hp: 38, atk: 11, def: 3, xp: 32, gold: 19, boss: false, taunt: "A purple slime hums with strange power.", ai: chase(1, 5) },
  rainbow: { name: "Rainbow Slime", hp: 60, atk: 12, def: 4, xp: 80, gold: 60, boss: false, taunt: "A rainbow slime shimmers. You have never seen one before.", ai: chase(1, 6) },
  bigslime: { name: "The Great Slime", hp: 96, atk: 15, def: 2, xp: 60, gold: 50, boss: true, taunt: "The ground quakes. The slimes you freed were only its children.", ai: { mode: "still", every: 1, range: 0 } },
};

export const SLIME_COLORS: SlimeColor[] = ["green", "blue", "orange", "red", "purple", "rainbow"];
// Rarer as they get harder. Rainbow is one in a hundred.
export const SLIME_WEIGHTS: Record<SlimeColor, number> = { green: 38, blue: 26, orange: 18, red: 11, purple: 6, rainbow: 1 };
export const SLIME_WAVE = 14;

// ---------------------------------------------------------------------------------------- gear and magic

export type WeaponId = "fists" | "lightbringer" | "bow" | "polearm" | "axe" | "prism";
export const WEAPONS: Record<WeaponId, { name: string; atk: number; trait: string }> = {
  fists: { name: "Bare hands", atk: 0, trait: "Nothing yet." },
  lightbringer: { name: "Lightbringer Blade", atk: 4, trait: "Charges a Flame Strike that deals triple damage." },
  bow: { name: "Hunter's Bow", atk: 2, trait: "A third of shots fly twice." },
  polearm: { name: "Polearm", atk: 3, trait: "Pierces 2 points of armor." },
  axe: { name: "Battle Axe", atk: 5, trait: "Heavy: costs 1 point of defense." },
  prism: { name: "Prism Blade", atk: 6, trait: "Every strike crackles with a random element." },
};

export const SPELLS: Record<Element, { name: string; cost: number; blurb: string }> = {
  fire: { name: "Fireball", cost: 3, blurb: "Burns the target for two more turns." },
  water: { name: "Tide", cost: 3, blurb: "Heals you, and may freeze the target." },
  air: { name: "Gale", cost: 3, blurb: "Ignores armor." },
  earth: { name: "Stone Fist", cost: 3, blurb: "Hard hit, and you brace for the reply." },
  universal: { name: "Clear Light", cost: 6, blurb: "Big damage and a little healing." },
};

export const DASH_COST = 2;
export const DASH_LENGTH = 3;
export const SPECIAL_MAX = 7;

// What the dash leaves behind, tile by tile.
export const TRAILS: Record<Element, string> = {
  fire: "Flames: burn what steps in them.",
  water: "Ice: freezes what steps on it.",
  air: "Wind: blows enemies back, dazed.",
  earth: "Stone: blocks enemies for a while.",
  universal: "Light: briefly stuns what touches it.",
};
export const TRAIL_TURNS = 7;

// ---------------------------------------------------------------------------------------- quests

export type Quest = { id: string; title: string; xp: number; text: string; optional?: boolean };
export const QUESTS: Quest[] = [
  { id: "woodcutter", title: "Woodcutter", xp: 6, text: "Take the axe from the stump and fell the old tree.", optional: true },
  { id: "caves", title: "Into the Mountains", xp: 6, text: "Leave the field and enter the Unyielding Mountains." },
  { id: "plates", title: "Pressure Points", xp: 12, text: "Answer the pressure-plate riddles without poisoning yourself twice.", optional: true },
  { id: "golem", title: "Rock Breaker", xp: 14, text: "Take the pickaxe and shatter the stone golem.", optional: true },
  { id: "crystals", title: "Elemental Awakening", xp: 10, text: "Touch all five crystals.", optional: true },
  { id: "run", title: "Through the Caves", xp: 20, text: "Outrun the boulder and leave the caves." },
  { id: "falls", title: "Behind the Waterfall", xp: 6, text: "Find the table behind the falls.", optional: true },
  { id: "secret", title: "The Secret Master", xp: 10, text: "Find the Secret Master's hideout in the valley wall.", optional: true },
  { id: "drawf", title: "Old Friends", xp: 6, text: "Meet Drawf outside the Temple." },
  { id: "flame", title: "The Flame Trial", xp: 14, text: "Open the way through the Temple's hall." },
  { id: "scholar", title: "Scholar of the Flame", xp: 12, text: "Read all eight tomes in the sanctum.", optional: true },
  { id: "levers", title: "Mind the Levers", xp: 6, text: "Pull the lever that opens the way out of the sanctum." },
  { id: "slimes", title: "Liberating the Slime Fields", xp: 30, text: "Defeat every slime in the Slime Fields." },
  { id: "spikes", title: "Spike Runner", xp: 12, text: "Cross the spiked floor before it rises.", optional: true },
  { id: "prism", title: "Prism Hunter", xp: 25, text: "Bring something rare to the Secret Master's treehouse.", optional: true },
  { id: "great", title: "The Great Slime", xp: 40, text: "Defeat the Great Slime." },
];

// ---------------------------------------------------------------------------------------- loot

export type Loot = { potion?: number; gold?: number; shield?: number };
export const CHESTS: Record<string, { loot: Loot; text: string }> = {
  stash: { loot: { potion: 1, gold: 8 }, text: "A traveller's stash: a potion and a few coins. Someone didn't make it out." },
  altar: { loot: { shield: 1, potion: 2, gold: 20 }, text: "A round shield, two potions and a purse of coins. The altar's secret." },
};

// What a smashed pot gives back. Most are empty; that is the point.
export const POT_LOOT: { weight: number; gold?: number; potion?: number; text: string }[] = [
  { weight: 34, text: "Just dust." },
  { weight: 26, gold: 2, text: "A couple of coins roll out." },
  { weight: 14, gold: 5, text: "A handful of coins!" },
  { weight: 18, potion: 1, text: "A healing potion, intact." },
  { weight: 8, gold: 12, text: "A small fortune in a pot." },
];

// ---------------------------------------------------------------------------------------- the areas

// A symbol on the map: a bit of ground, an entity standing on it, or both.
export type Spec = { ground?: Ground } & Partial<Omit<Entity, "id" | "area" | "x" | "y">>;
// A map the project's own editor drew, cropped to the cells the rules need (see tools/mereddia/convert.mjs).
export type Grid = {
  x0: number;
  y0: number;
  w: number;
  h: number;
  rows: string[];
  entities: { kind: "objects" | "characters" | "tiles"; m: string; id?: string; x: number; y: number; passable?: boolean; scripts?: { trigger: number; name?: string; quick?: string }[]; dir?: string }[];
};

export type Zone = { id: string; name: string; rect: [number, number, number, number]; indoor?: boolean };

export type AreaDef = {
  id: AreaId;
  name: string;
  theme: Theme;
  rows: string[];
  sym: Record<string, Spec>;
  // Where the hero first appears (only the field has one that isn't an arrival).
  start?: { x: number; y: number };
  // Where the hero arrives when the story sends him here without a door.
  arrive?: { x: number; y: number };
  // Areas built from the project's own 3D maps: the converted map's name, and the grid's offset in it.
  // `mountains` lists wall tiles the 3D view draws as real mountains.
  map3d?: { name: string; x0: number; y0: number; mountains?: string[]; pitch?: number; distance?: number; cutZ?: number; summer?: boolean };
  // Things standing in the area that the map data places rather than the rows.
  extra?: (Spec & { x: number; y: number })[];
  // Parts of a big map with a name of their own, and whether they are buildings (Ricky waits outside those).
  zones?: Zone[];
  // A boulder that rolls from `start` to `end` along the same column once triggered; it crushes anyone in
  // the corridor `x0..x1` that it catches. `speed` is tiles per tick.
  boulder?: { start: { x: number; y: number }; end: { x: number; y: number }; x0: number; x1: number; speed: number };
  // Stone slabs that crash down to seal a way behind the hero, by name.
  seals?: Record<string, { x: number; y: number }[]>;
  // Whether the whole area is a building (the treehouse).
  indoor?: boolean;
};

const npc = (what: string): Spec => ({ kind: "npc", what });
const prop = (what: string): Spec => ({ kind: "prop", what });
const btn = (what: string): Spec => ({ kind: "button", what });
const exit = (area: AreaId, x: number, y: number, ask?: string): Spec => ({ kind: "exit", what: area, to: { area, x, y }, ask });
const trigger = (what: string): Spec => ({ kind: "plate", what: `t:${what}` });

type GridEntity = Grid["entities"][number];

// What a sign says: every message its script shows, one per line.
const messages = (e: GridEntity) =>
  (e.scripts ?? [])
    .flatMap((s) => [...(s.quick ?? "").matchAll(/display_message\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1].replace(/\\n/g, "\n")))
    .join("\n");
const scriptOf = (e: GridEntity) => e.scripts?.[0]?.name ?? e.scripts?.[0]?.quick ?? "";

// Which of a map's placed things take part in the rules. `rule` decides, for each, what it is (or null if
// it is only scenery). Impassable objects nobody claims become plain solid scenery, so they still block the
// way. Things sharing a cell (a pickaxe stuck in a boulder) become one thing that hides both pictures.
function bind(grid: Grid, rule: (e: GridEntity, grid: Grid) => Spec | null): (Spec & { x: number; y: number })[] {
  const cells = new Map<string, GridEntity[]>();
  for (const e of grid.entities) (cells.get(`${e.x},${e.y}`) ?? cells.set(`${e.x},${e.y}`, []).get(`${e.x},${e.y}`)!).push(e);
  const out: (Spec & { x: number; y: number })[] = [];
  for (const [key, list] of cells) {
    const [x, y] = key.split(",").map(Number);
    let spec: Spec | null = null;
    for (const e of list) {
      spec = rule(e, grid);
      if (spec) break;
    }
    if (!spec && list.some((e) => e.kind === "objects" && e.passable === false)) spec = prop("scenery");
    if (!spec) continue;
    // (Only the pickaxe is taken from its rock: the rock stays, so only the pickaxe is what the rules stand in for.)
    const src = list.filter((e) => e.kind !== "tiles" && (spec!.what !== "pickrock" || e.m === "pickaxe")).map((e) => `${e.m}@${e.x + grid.x0},${e.y + grid.y0}`).join("|");
    out.push({ ...spec, x, y, ...(src ? { src } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------- the plate room

// Four columns of four plates, east to west, numbered from the bottom row up. A plate is safe unless its
// script says it releases the poison: that is the project's own puzzle, and the Secret Master's hint.
const PLATE_COLUMNS = [...new Set(cavesGrid.entities.filter((e) => e.m === "Pressure_plate").map((e) => e.x))].sort((a, b) => b - a);
const PLATE_BOTTOM = Math.max(...cavesGrid.entities.filter((e) => e.m === "Pressure_plate").map((e) => e.y)) + 1;
export const plateRow = (y: number) => PLATE_BOTTOM - y;
export const PLATE_ANS: number[] = PLATE_COLUMNS.map((x) => {
  const safe = cavesGrid.entities.find((e) => e.m === "Pressure_plate" && e.x === x && !(e.scripts ?? []).some((s) => s.name === "Pressure_plate_down"));
  return safe ? plateRow(safe.y) : 1;
});

const CRYSTAL: Record<string, string> = { crystal_fire: "fire", crystal_water: "water", crystal_air: "air", crystal_earth: "earth", crystal_all: "universal" };

const cavesRule = (e: GridEntity): Spec | null => {
  const s = scriptOf(e);
  switch (e.m) {
    case "sign":
    case "2":
      return { kind: "prop", what: "sign", text: messages(e) };
    case "pot":
      return { kind: "pot", what: "pot" };
    case "pickaxe":
      // The pickaxe stands in a rock (the boulder next to it in the same cell): you take it from the rock, and the rock stays.
      return { kind: "prop", what: "pickrock" };
    case "Locked_door":
      return { kind: "gate", what: "gate" };
    case "knowledge_exit_1":
    case "knowledge_exit_2":
      return e.id === "a" || e.id === "b" ? { kind: "panel", what: "plates" } : null;
    case "Golem":
      return { kind: "enemy", what: "golem" };
    case "Secret Master":
      return npc("master");
    case "Steven":
      return npc("stefan");
    case "Joshua":
      return npc("joshua");
    case "Clavicus":
      return npc("clavicus");
    case "dead keeper":
      return { kind: "prop", what: "deadkeeper" };
    case "Pressure_plate": {
      const col = PLATE_COLUMNS.indexOf(e.x);
      return col < 0 ? null : { kind: "plate", what: `p:${col}:${plateRow(e.y)}` };
    }
  }
  if (CRYSTAL[e.m]) return { kind: "crystal", what: CRYSTAL[e.m] };
  if (e.kind !== "tiles") return null;
  if (s === "Mal_First_Time") return trigger("master");
  if (s === "move_boulder") return trigger("boulder");
  if (s === "close_golem") return trigger("golemTrap");
  if (s.includes('load_map("The Temple"')) return exit("temple", 36, 32);
  if (s.includes("QUEST_0005")) return trigger("golemQuest");
  return null;
};

// ---------------------------------------------------------------------------------------- the temple

const BOOKCASES = templeGrid.entities.filter((e) => e.m === "bookcase").sort((a, b) => a.x - b.x);

const templeRule = (e: GridEntity): Spec | null => {
  switch (e.m) {
    case "bookcase":
      return { kind: "prop", what: `shelf:${BOOKCASES.indexOf(e)}` };
    case "altar":
      return prop("flame");
    case "lever":
      return { kind: "lever", what: e.id === "Lever_R" ? "raise" : "lower" };
    case "Vastios":
      return npc("vastios");
    case "Wilfred":
      return npc("wilfred");
    case "Drawf_Dialogue":
      return npc("drawf");
    case "Secret Master":
      return npc("master");
    case "table":
      return prop("table");
    case "door":
      return { kind: "panel", what: "door" };
    case "button_wall":
      return btn("mountain");
    case "button_blue":
      return btn("L1");
    case "button_gold":
      return btn("gold");
    case "button_red_2":
      return btn("R1");
    case "button_red":
    case "button_green":
    case "button_purple":
    case "button_yellow_2":
    case "button_green_2":
    case "button_blue_2":
      return btn("decoy");
    case "stone_wall_5":
      return e.id === "1" ? { kind: "panel", what: "w1" } : null;
    case "stone_wall_7":
      return { kind: "panel", what: "w3" };
    case "fake_altar":
      return { kind: "panel", what: "fake" };
  }
  return null;
};

// ---------------------------------------------------------------------------------------- the areas

// The tree and the stump are two tiles wide and deep in the project (their models cover the placed cell and the three
// east and south of it), so the three cells beside each one are solid too. A bump on any of them is a bump on it.
function footprint<T extends { x: number; y: number; kind?: string; what?: string }>(specs: T[]): (T | { x: number; y: number; kind: "prop"; what: string })[] {
  return specs.flatMap((e) => (e.kind === "prop" && (e.what === "tree" || e.what === "stump") ? [e, ...[[1, 0], [0, 1], [1, 1]].map(([dx, dy]) => ({ x: e.x + dx, y: e.y + dy, kind: "prop" as const, what: `${e.what}block` }))] : [e]));
}

// Every open cell along one side of an area, two deep, as the same exit: the way out is the whole edge, not one cell of it. Corners
// go to whichever side claims them first.
const taken = new Set<string>();
function edgeBand(rows: string[], side: "west" | "east" | "north", make: (y: number) => Spec): (Spec & { x: number; y: number })[] {
  const h = rows.length;
  const w = rows[0].length;
  const out: (Spec & { x: number; y: number })[] = [];
  const cells: [number, number][] = [];
  for (let d = 0; d < 2; d++) {
    if (side === "north") for (let x = 0; x < w; x++) cells.push([x, d]);
    else for (let y = 0; y < h; y++) cells.push([side === "west" ? d : w - 1 - d, y]);
  }
  for (const [x, y] of cells) {
    const k = `${rows.length}:${x},${y}`;
    if (rows[y][x] === "#" || taken.has(k)) continue;
    taken.add(k);
    out.push({ ...make(y), x, y });
  }
  return out;
}

export const AREAS: Record<AreaId, AreaDef> = {
  field: {
    id: "field",
    name: "The Southern Field",
    theme: "field",
    rows: fieldGrid.rows,
    sym: {},
    start: { x: 27, y: 24 },
    // The first field is a bright summer's day, the world as it ought to be, before it starts to come apart.
    map3d: { name: "start_area", x0: fieldGrid.x0, y0: fieldGrid.y0, summer: true },
    extra: [
      ...footprint(bind(fieldGrid, (e) => (e.m === "tree_me" ? prop("tree") : e.m === "stump" ? prop("stump") : e.m === "Sign_other" ? prop("trailsign") : null))),
      // The path leads west to the mountains, east to Dresden and north to the slime fields. Each way out is the whole edge of the
      // field on that side (two cells deep, so a dash cannot jump it), not just the one cell where the path crosses it.
      ...edgeBand(fieldGrid.rows, "west", (y) => ({ ...exit("caves", 40, 40, "go_caves"), y })),
      // Dresden: "no reason to go there at this time", until the story brings you back.
      ...edgeBand(fieldGrid.rows, "east", () => ({ kind: "exit", what: "edge_east", ask: "edge_east", to: { area: "dresden", x: 1, y: 19 } })),
      ...edgeBand(fieldGrid.rows, "north", () => ({ kind: "exit", what: "edge_north", ask: "edge_north" })),
    ],
  },
  caves: {
    id: "caves",
    name: "The Unyielding Caves",
    theme: "cave",
    // The sunken pool in the caves is the magical spring: its water is walkable ("s") but only reached by the prompt at its rim.
    rows: cavesGrid.rows.map((r, y) => (y === 4 ? `${r.slice(0, 20)}sssss${r.slice(25)}` : y >= 2 && y <= 6 ? `${r.slice(0, 21)}ssss${r.slice(25)}` : r)),
    sym: {},
    arrive: { x: 40, y: 40 },
    map3d: { name: "Caves", x0: cavesGrid.x0, y0: cavesGrid.y0, cutZ: 48 },
    boulder: { start: { x: 4, y: 30 }, end: { x: 4, y: 2 }, x0: 1, x1: 7, speed: 0.8 },
    seals: {
      boulder: [{ x: 8, y: 24 }, { x: 8, y: 25 }],
      golem: [{ x: 14, y: 44 }, { x: 15, y: 44 }],
    },
    // The dead end where Stefan stands has a loose floorboard.
    extra: [
      ...bind(cavesGrid, cavesRule),
      { x: 42, y: 40, ...exit("field", 2, 33) },
      { x: 41, y: 4, ...exit("spikes", 2, 6, "spike_hatch") },
      // The man bathing in the spring, and the two prompts that carry you in beside him and out again.
      // (He is drawn by the map itself, where the project sat him, so the rules only give him something to bump into.)
      { x: 20, y: 4, kind: "npc", what: "alexis" },
      { x: 26, y: 4, ...exit("caves", 22, 4, "spring_in") },
      { x: 24, y: 4, ...exit("caves", 27, 4, "spring_out") },
    ],
  },
  temple: {
    id: "temple",
    name: "The Valley of Time",
    theme: "valley",
    rows: templeGrid.rows,
    sym: {},
    arrive: { x: 36, y: 32 },
    map3d: { name: "The Temple", x0: templeGrid.x0, y0: templeGrid.y0, mountains: ["Wall", "Wall2", "Wall3", "Wall4", "Wall5"], pitch: 0.78, distance: 14 },
    zones: [
      { id: "falls", name: "Behind the Falls", rect: [32, 1, 34, 2] },
      { id: "hideout", name: "The Secret Master's Hideout", rect: [1, 9, 8, 17] },
      { id: "sanctum", name: "The Sanctum", rect: [18, 5, 24, 10], indoor: true },
      { id: "hall", name: "The Temple Hall", rect: [18, 12, 24, 17], indoor: true },
    ],
    extra: [
      ...bind(templeGrid, templeRule),
      // The secret passage: the wall button in the hall's west wall opens the rock at (13,13) into the Secret Master's room.
      { x: 13, y: 13, kind: "panel", what: "secret", src: `tile@${13 + templeGrid.x0},${13 + templeGrid.y0}` },
    ],
  },
  slimes: {
    id: "slimes",
    name: "The Slime Fields",
    theme: "field",
    rows: slimesGrid.rows,
    sym: {},
    arrive: { x: 18, y: 29 },
    map3d: { name: "sword_area", x0: slimesGrid.x0, y0: slimesGrid.y0 },
    extra: [
      ...bind(slimesGrid, (e) => (e.m === "Statue" ? prop("statue") : e.m === "Vastios" ? npc("vastios") : null)),
      // The Secret Master stands by the road in, with a hint. The way to his treehouse is a certain tile, off in
      // the far southeast corner of the fields: step on it and the ground carries you there.
      { x: 21, y: 28, ...npc("master") },
      { x: 31, y: 30, ...exit("treehouse", 5, 5, "tree_tele") },
    ],
  },
  // The Temple again, months later: where the oath is sworn. Only the cutscene uses it.
  finale: {
    id: "finale",
    name: "The Sanctum, Months Later",
    theme: "temple",
    rows: finaleGrid.rows,
    sym: {},
    arrive: { x: 22, y: 10 },
    map3d: { name: "The Temple Finale", x0: finaleGrid.x0, y0: finaleGrid.y0, mountains: ["Wall", "Wall2", "Wall3", "Wall4", "Wall5"], pitch: 0.78, distance: 14 },
    zones: [
      { id: "sanctum", name: "The Sanctum", rect: [18, 5, 24, 10], indoor: true },
      { id: "hall", name: "The Temple Hall", rect: [18, 12, 24, 17], indoor: true },
    ],
  },
  // Dresden, as far as the project has built it: an empty meadow with a path. Chapter 1 starts here.
  dresden: {
    id: "dresden",
    name: "Dresden",
    theme: "field",
    rows: dresdenGrid.rows,
    sym: {},
    arrive: { x: 18, y: 19 },
    map3d: { name: "Village I forgor", x0: dresdenGrid.x0, y0: dresdenGrid.y0 },
    extra: [{ x: 0, y: 19, ...exit("field", 57, 32) }],
  },
  // A chamber whose floor is full of spikes. They rise a moment after you step in.
  spikes: {
    id: "spikes",
    name: "The Spiked Floor",
    theme: "cave",
    indoor: true,
    rows: spikesGrid.rows,
    sym: {},
    arrive: { x: 2, y: 6 },
    map3d: { name: "Spike_Trap", x0: spikesGrid.x0, y0: spikesGrid.y0, pitch: 0.95, distance: 9 },
    extra: [{ x: 2, y: 1, ...exit("caves", 41, 5) }],
  },
  treehouse: {
    id: "treehouse",
    name: "The Secret Master's Treehouse",
    theme: "wood",
    indoor: true,
    rows: treehouseGrid.rows,
    sym: {},
    arrive: { x: 5, y: 5 },
    map3d: { name: "treehouse", x0: treehouseGrid.x0, y0: treehouseGrid.y0, pitch: 0.9, distance: 10 },
    // The Secret Master by the table, and the ladder down at the door.
    extra: [...bind(treehouseGrid, (e) => (e.m === "Secret Master" ? npc("master") : null)), { x: 5, y: 7, ...exit("slimes", 30, 30) }],
  },
};

export const AREA_IDS = Object.keys(AREAS) as AreaId[];

// The part of a big map the hero is standing in, if it has a name of its own.
export const zoneAt = (area: AreaId, x: number, y: number): Zone | undefined => AREAS[area].zones?.find((z) => x >= z.rect[0] && x <= z.rect[2] && y >= z.rect[1] && y <= z.rect[3]);
export const isIndoor = (area: AreaId, x: number, y: number) => !!AREAS[area].indoor || !!zoneAt(area, x, y)?.indoor;

// The map objects an area's rules stand in for, so the 3D view knows which scenery to hide when they're gone.
export const bound = (area: AreaId) =>
  (AREAS[area].extra ?? []).flatMap((e) => (e.src ? [{ src: e.src, id: `${area}:${e.kind}:${e.what}@${e.x},${e.y}`, dynamic: e.kind === "npc" || e.kind === "enemy" }] : []));

// ---------------------------------------------------------------------------------------- parsing

const GROUND_CHARS = new Set(["#", "~", ".", "=", "w", "s"]);

export type Parsed = { ground: Ground[][]; entities: Entity[]; width: number; height: number };
const cache = new Map<AreaId, Parsed>();

export function parseArea(id: AreaId): Parsed {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = AREAS[id];
  const ground: Ground[][] = [];
  const entities: Entity[] = [];
  def.rows.forEach((row, y) => {
    ground.push([]);
    [...row].forEach((c, x) => {
      const spec = def.sym[c];
      let g: Ground = ".";
      if (GROUND_CHARS.has(c)) g = c as Ground;
      else if (!spec) throw new Error(`Unknown map symbol '${c}' in ${id} at ${x},${y}`);
      if (spec?.ground) g = spec.ground;
      if (spec?.kind) {
        const { ground: _g, ...rest } = spec;
        entities.push({ ...(rest as Pick<Entity, "kind" | "what">), id: `${id}:${spec.kind}:${spec.what}@${x},${y}`, area: id, x, y });
      }
      ground[y].push(g);
    });
  });
  for (const { x, y, ...spec } of def.extra ?? []) {
    const { ground: _g, ...rest } = spec;
    entities.push({ ...(rest as Pick<Entity, "kind" | "what">), id: `${id}:${spec.kind}:${spec.what}@${x},${y}`, area: id, x, y });
  }
  const parsed = { ground, entities, width: def.rows[0].length, height: def.rows.length };
  cache.set(id, parsed);
  return parsed;
}

export const groundIn = (area: AreaId, x: number, y: number): Ground => {
  const p = parseArea(area);
  return x < 0 || y < 0 || x >= p.width || y >= p.height ? "#" : p.ground[y][x];
};

export const sizeOf = (area: AreaId) => {
  const { width, height } = parseArea(area);
  return { width, height };
};
