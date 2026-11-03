import { CHESTS, ENEMIES, HEIGHT, NPC_NAMES, WIDTH, parseMap, type EnemyKind, type Entity, type Ground, type NpcKind } from "./world";

// Journey Across Mereddia's rules: walk the map, bump into things, fight one on one. Everything is a
// pure function of the state and an action, and the state is plain JSON, so it saves to localStorage
// as it is and tests can play whole games. Randomness comes from `rng` inside the state.

export type Dir = "up" | "down" | "left" | "right";
export type Action =
  | { type: "move"; dir: Dir }
  | { type: "next" }
  | { type: "attack" }
  | { type: "guard" }
  | { type: "crystal" }
  | { type: "potion" }
  | { type: "flee" };

export type Battle = { enemyId: string; kind: EnemyKind; hp: number; guarding: boolean };
export type Dialogue = { speaker: string; sprite: NpcKind; lines: string[]; i: number };
export type Mode = "explore" | "battle" | "dialogue" | "won" | "lost";

export type State = {
  rng: number;
  mode: Mode;
  pos: { x: number; y: number };
  level: number;
  xp: number;
  hp: number;
  gold: number;
  potions: number;
  crystals: number;
  keys: number;
  sword: boolean;
  entities: Entity[];
  flags: Record<string, true>;
  battle?: Battle;
  dialogue?: Dialogue;
  // Newest last.
  log: string[];
  steps: number;
};

export const POTION_HEAL = 15;
export const SWORD_PRICE = 10;
export const POTION_PRICE = 8;
export const LOG_LINES = 5;
const GROUND = parseMap();

export const maxHp = (level: number) => 24 + 8 * (level - 1);
export const attackOf = (s: Pick<State, "level" | "sword">) => 4 + 2 * (s.level - 1) + (s.sword ? 3 : 0);
export const defenseOf = (level: number) => level;
export const xpToNext = (level: number) => 8 * level;

export function newGame(seed = Date.now()): State {
  return {
    rng: seed | 0,
    mode: "explore",
    pos: { ...GROUND.start },
    level: 1,
    xp: 0,
    hp: maxHp(1),
    gold: 0,
    potions: 0,
    crystals: 0,
    keys: 0,
    sword: false,
    entities: GROUND.entities.map((e) => ({ ...e })),
    flags: {},
    log: ["Wilfred wakes at the edge of the Mereddian wood."],
    steps: 0,
  };
}

// mulberry32, advancing the state's own seed.
function roll(s: State): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const say = (s: State, line: string) => {
  s.log.push(line);
  if (s.log.length > LOG_LINES) s.log.splice(0, s.log.length - LOG_LINES);
};

export const groundAt = (x: number, y: number): Ground => (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT ? "#" : GROUND.ground[y][x]);
export const entityAt = (s: Pick<State, "entities">, x: number, y: number) => s.entities.find((e) => e.x === x && e.y === y);

const STEP: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const WIN_TEXT = "Mallakoth falls, and the dark lifts from Mereddia. The journey is over.";

export function act(prev: State, a: Action): State {
  const s = structuredClone(prev);
  if (s.mode === "won" || s.mode === "lost") return s;
  if (a.type === "potion") return drink(s);
  if (s.mode === "dialogue") return a.type === "next" ? advance(s) : s;
  if (s.mode === "battle") return fight(s, a);
  if (a.type === "move") return move(s, a.dir);
  return s;
}

function drink(s: State): State {
  if (s.potions <= 0) {
    say(s, "No potions left.");
    return s;
  }
  if (s.hp >= maxHp(s.level)) {
    say(s, "You're already in good health.");
    return s;
  }
  s.potions--;
  const healed = Math.min(POTION_HEAL, maxHp(s.level) - s.hp);
  s.hp += healed;
  say(s, `You drink a potion and recover ${healed} HP.`);
  if (s.mode === "battle") enemyTurn(s);
  return s;
}

function advance(s: State): State {
  const d = s.dialogue!;
  if (d.i + 1 < d.lines.length) s.dialogue = { ...d, i: d.i + 1 };
  else {
    delete s.dialogue;
    s.mode = "explore";
  }
  return s;
}

function move(s: State, dir: Dir): State {
  const [dx, dy] = STEP[dir];
  const x = s.pos.x + dx;
  const y = s.pos.y + dy;
  if (groundAt(x, y) !== ".") return s;
  const e = entityAt(s, x, y);
  if (e) return touch(s, e);
  s.pos = { x, y };
  s.steps++;
  return s;
}

function touch(s: State, e: Entity): State {
  if (e.kind === "enemy") return startFight(s, e);
  if (e.kind === "npc") return talk(s, e);
  if (e.kind === "chest") return openChest(s, e);
  if (s.keys > 0) {
    s.keys--;
    s.entities = s.entities.filter((o) => o !== e && o.id !== e.id);
    say(s, "The key turns and the gate grinds open.");
  } else say(s, "The gate is locked. There must be a key somewhere.");
  return s;
}

function startFight(s: State, e: Entity): State {
  const kind = e.what as EnemyKind;
  s.mode = "battle";
  s.battle = { enemyId: e.id, kind, hp: ENEMIES[kind].hp, guarding: false };
  say(s, ENEMIES[kind].taunt);
  return s;
}

function openChest(s: State, e: Entity): State {
  if (e.done) {
    say(s, "The chest is empty.");
    return s;
  }
  const { loot, text } = CHESTS[e.what];
  e.done = true;
  s.potions += loot.potion ?? 0;
  s.crystals += loot.crystal ?? 0;
  s.gold += loot.gold ?? 0;
  s.keys += loot.key ?? 0;
  say(s, text);
  return s;
}

function talk(s: State, e: Entity): State {
  const npc = e.what as NpcKind;
  let lines: string[];
  if (npc === "vastios") {
    if (!s.flags.vastios) {
      s.flags.vastios = true;
      s.potions += 2;
      lines = [
        "Wilfred. The Keeper has sealed the keep, and Mallakoth waits behind it.",
        "The gate's key lies east, past the golem. Take these potions; you'll want them.",
      ];
    } else lines = ["East for the key, then the gate in the south. Mind your health, Wilfred."];
  } else if (s.sword && s.gold >= POTION_PRICE) {
    s.gold -= POTION_PRICE;
    s.potions++;
    lines = [`A potion for ${POTION_PRICE} coins. Don't drink it all at once.`];
  } else if (s.sword) lines = [`Potions are ${POTION_PRICE} coins. Come back with more.`];
  else if (s.gold >= SWORD_PRICE) {
    s.gold -= SWORD_PRICE;
    s.sword = true;
    lines = [`A sword for ${SWORD_PRICE} coins. Fair trade.`, "You take the sword. Your attacks hit harder now."];
  } else lines = [`A sword costs ${SWORD_PRICE} coins, lad. The slimes drop plenty.`];
  s.mode = "dialogue";
  s.dialogue = { speaker: NPC_NAMES[npc], sprite: npc, lines, i: 0 };
  return s;
}

const hitRoll = (s: State, atk: number, def: number) => Math.max(1, atk + Math.floor(roll(s) * 3) - def);

function fight(s: State, a: Action): State {
  const b = s.battle!;
  const foe = ENEMIES[b.kind];
  b.guarding = false;
  if (a.type === "attack") {
    const dmg = hitRoll(s, attackOf(s), foe.def);
    b.hp -= dmg;
    say(s, `You hit the ${foe.name} for ${dmg}.`);
  } else if (a.type === "crystal") {
    if (s.crystals <= 0) {
      say(s, "You have no crystals.");
      return s;
    }
    s.crystals--;
    const dmg = attackOf(s) * 2 + 2;
    b.hp -= dmg;
    say(s, `A crystal bursts for ${dmg}, through any armor.`);
  } else if (a.type === "guard") {
    b.guarding = true;
    say(s, "You raise your guard.");
  } else if (a.type === "flee") {
    if (foe.boss) say(s, "There's no escaping this one.");
    else if (roll(s) < 0.5) {
      s.mode = "explore";
      delete s.battle;
      say(s, "You slip away.");
      return s;
    } else say(s, "You couldn't get away.");
  } else return s;
  if (b.hp <= 0) return win(s);
  return enemyTurn(s);
}

function enemyTurn(s: State): State {
  const b = s.battle!;
  const foe = ENEMIES[b.kind];
  let dmg = hitRoll(s, foe.atk, defenseOf(s.level));
  if (b.guarding) dmg = Math.ceil(dmg / 2);
  b.guarding = false;
  s.hp = Math.max(0, s.hp - dmg);
  say(s, `The ${foe.name} hits you for ${dmg}.`);
  if (s.hp <= 0) {
    s.mode = "lost";
    delete s.battle;
    say(s, "You fall. The journey ends here.");
  }
  return s;
}

function win(s: State): State {
  const b = s.battle!;
  const foe = ENEMIES[b.kind];
  s.entities = s.entities.filter((e) => e.id !== b.enemyId);
  delete s.battle;
  s.gold += foe.gold;
  s.xp += foe.xp;
  say(s, `The ${foe.name} is defeated.${foe.xp ? ` +${foe.xp} XP, +${foe.gold} gold.` : ""}`);
  while (s.xp >= xpToNext(s.level)) {
    s.xp -= xpToNext(s.level);
    s.level++;
    s.hp = maxHp(s.level);
    say(s, `Level ${s.level}! You feel stronger.`);
  }
  if (b.kind === "mallakoth") {
    s.mode = "won";
    say(s, WIN_TEXT);
  } else s.mode = "explore";
  return s;
}

// Whether a saved game is one this version can still read.
export function isState(v: unknown): v is State {
  const s = v as State | null;
  return (
    !!s &&
    typeof s === "object" &&
    typeof s.rng === "number" &&
    ["explore", "battle", "dialogue", "won", "lost"].includes(s.mode) &&
    typeof s.pos?.x === "number" &&
    typeof s.pos?.y === "number" &&
    typeof s.level === "number" &&
    typeof s.hp === "number" &&
    Array.isArray(s.entities) &&
    Array.isArray(s.log)
  );
}
