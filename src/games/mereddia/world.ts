// Journey Across Mereddia's world: one small map and everyone on it. Plain data, no React, so the
// engine and its tests can use it as it is.

export type EnemyKind = "slime" | "golem" | "keeper" | "mallakoth";
export type NpcKind = "vastios" | "dwarf";

export type EnemyDef = {
  name: string;
  hp: number;
  atk: number;
  def: number;
  xp: number;
  gold: number;
  boss: boolean;
  // Said when the fight starts.
  taunt: string;
};

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  slime: { name: "Slime", hp: 10, atk: 4, def: 0, xp: 7, gold: 5, boss: false, taunt: "A slime wobbles into your path." },
  golem: { name: "Stone Golem", hp: 28, atk: 6, def: 2, xp: 22, gold: 15, boss: false, taunt: "The golem grinds awake." },
  keeper: { name: "Keeper of the Gate", hp: 36, atk: 8, def: 2, xp: 40, gold: 20, boss: true, taunt: "\"None pass,\" the Keeper intones." },
  mallakoth: { name: "Mallakoth", hp: 60, atk: 11, def: 3, xp: 0, gold: 0, boss: true, taunt: "Mallakoth rises from the dark. \"At last.\"" },
};

export type Loot = { potion?: number; crystal?: number; gold?: number; key?: number };

export type EntityKind = "npc" | "chest" | "enemy" | "gate";
export type Entity = {
  id: string;
  kind: EntityKind;
  // Which enemy, npc or chest this is.
  what: string;
  x: number;
  y: number;
  // A chest that's been opened.
  done?: boolean;
};

export const CHESTS: Record<string, { loot: Loot; text: string }> = {
  key: { loot: { key: 1 }, text: "An iron key, cold and heavy. It must fit the gate." },
  crystals: { loot: { crystal: 2, gold: 10 }, text: "Two glowing crystals and a few coins." },
  last: { loot: { potion: 2 }, text: "Two healing potions. Someone wanted you ready." },
};

export const NPC_NAMES: Record<NpcKind, string> = { vastios: "Vastios", dwarf: "The Dwarf" };

// '#' tree or rock, '~' water, '.' ground; the letters are things standing on ground.
//   P you   V Vastios   D the Dwarf   s slime   G golem   K keeper   M Mallakoth   + gate
//   1, 2, 3 are chests (key, crystals, last)
export const MAP = [
  "################",
  "#P..V.s.#.....1#",
  "#...~~..#..G...#",
  "#.s.~~.........#",
  "#...~~..#......#",
  "#.D.......s...2#",
  "########+#######",
  "########.#######",
  "########K#######",
  "#.3....M.......#",
  "################",
];

export const WIDTH = MAP[0].length;
export const HEIGHT = MAP.length;

const CHEST_KEYS: Record<string, string> = { "1": "key", "2": "crystals", "3": "last" };
const ENEMY_KEYS: Record<string, EnemyKind> = { s: "slime", G: "golem", K: "keeper", M: "mallakoth" };

export type Ground = "#" | "~" | ".";

export function parseMap(rows: string[] = MAP): { ground: Ground[][]; start: { x: number; y: number }; entities: Entity[] } {
  const ground: Ground[][] = [];
  const entities: Entity[] = [];
  let start = { x: 1, y: 1 };
  rows.forEach((row, y) => {
    ground.push([]);
    [...row].forEach((c, x) => {
      const at = `${x},${y}`;
      let g: Ground = ".";
      if (c === "#" || c === "~") g = c;
      else if (c === "P") start = { x, y };
      else if (c === "V") entities.push({ id: `npc:${at}`, kind: "npc", what: "vastios", x, y });
      else if (c === "D") entities.push({ id: `npc:${at}`, kind: "npc", what: "dwarf", x, y });
      else if (c === "+") entities.push({ id: `gate:${at}`, kind: "gate", what: "gate", x, y });
      else if (CHEST_KEYS[c]) entities.push({ id: `chest:${CHEST_KEYS[c]}`, kind: "chest", what: CHEST_KEYS[c], x, y });
      else if (ENEMY_KEYS[c]) entities.push({ id: `enemy:${at}`, kind: "enemy", what: ENEMY_KEYS[c], x, y });
      ground[y].push(g);
    });
  });
  return { ground, start, entities };
}
