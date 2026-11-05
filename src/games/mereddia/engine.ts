import {
  AREAS,
  AREA_IDS,
  CHESTS,
  DASH_COST,
  DASH_LENGTH,
  ELEMENTS,
  ENEMIES,
  PLATE_ANS,
  POT_LOOT,
  QUESTS,
  SLIME_COLORS,
  SLIME_WAVE,
  SLIME_WEIGHTS,
  SPECIAL_MAX,
  SPELLS,
  TRAIL_TURNS,
  WALKABLE,
  WEAPONS,
  groundIn,
  isIndoor,
  parseArea,
  zoneAt,
  type AreaId,
  type Dir,
  type Element,
  type EnemyKind,
  type Entity,
  type Ground,
  type Spot,
  type WeaponId,
} from "./world";
import { LORE, NODES, NOTE_QUIPS, type Choice } from "./story";

export type { Dir } from "./world";

// Journey Across Mereddia's rules. Everything is a pure function of the state and an action, and the
// state is plain JSON, so it saves to localStorage as it is and tests can play whole games. Randomness
// comes from `rng` inside the state. Time moves in ticks: every step, dash or button press is one,
// and on each tick the slimes shuffle, the golem throws rocks and the boulder rolls.

export type Action =
  // `keep`: step that way without turning to face it (backing up).
  | { type: "move"; dir: Dir; sprint?: boolean; keep?: boolean }
  // Turn on the spot, no step taken.
  | { type: "turn"; dir: Dir }
  | { type: "next" }
  | { type: "choose"; i: number }
  | { type: "attack" }
  | { type: "guard" }
  | { type: "dodge" }
  | { type: "spell" }
  | { type: "special" }
  | { type: "potion" }
  | { type: "flee" }
  | { type: "element"; el: Element }
  | { type: "dash" }
  | { type: "wait" }
  | { type: "equip"; weapon: WeaponId }
  | { type: "retry" }
  | { type: "continue" }
  // Swing the axe at whatever is in front (the E key, or the Swing button).
  | { type: "swing" }
  | { type: "seen" };

// What a fighter is about to do. The enemy shows its intent before you choose, so every choice is an answer.
export type Intent = "strike" | "heavy" | "swift";
export type Battle = {
  enemyId: string;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  guarding: boolean;
  burn: number;
  stun: number;
  // The enemy's next move.
  intent: Intent;
  // Hits landed in a row; each adds damage, and getting hit ends it.
  combo: number;
  // Damage soaked up towards a Break, which robs the enemy of its next move.
  stagger: number;
  broken: number;
  // What each side just did, for the animations, and how many turns have passed.
  last: { hero: string; foe: string };
  turn: number;
};
export type Dialogue = { node: string; ref?: string; text?: string };
export type Mode = "explore" | "battle" | "dialogue" | "won" | "lost";
export type Quiz = { ans: number[]; step: number; wrong: number; done: boolean };
export type Trail = { area: AreaId; x: number; y: number; el: Element; ttl: number };
export type Hazard = { x: number; y: number; fuse: number };

export type State = {
  v: 2;
  rng: number;
  mode: Mode;
  area: AreaId;
  pos: { x: number; y: number };
  facing: Dir;
  level: number;
  xp: number;
  hp: number;
  mana: number;
  manaBonus: number;
  stamina: number;
  special: number;
  gold: number;
  potions: number;
  keys: number;
  // What the axe and the pickaxe bring home, for crafting.
  wood?: number;
  stone?: number;
  element: Element;
  magic: Record<Element, number>;
  weapon: WeaponId;
  weapons: WeaponId[];
  items: Record<string, true>;
  shield: boolean;
  poisoned: boolean;
  companion?: "ricky";
  ricky?: { x: number; y: number };
  entities: Entity[];
  flags: Record<string, true>;
  quests: Record<string, true>;
  quiz: Quiz;
  trails: Trail[];
  hazards: Hazard[];
  timers: { id: string; left: number }[];
  boulder?: { pos: number };
  // The spiked floor: ticks until the spikes rise.
  spike?: { left: number; total: number };
  // A cutscene for the view to play before anything else; the view clears it with `seen` when it is over.
  cut?: { id: string; n: number };
  // The named part of a big map the hero is standing in.
  zone?: string;
  battle?: Battle;
  dlg?: Dialogue;
  // The last gesture Mallakoth made (a lever, a swing of the axe), and how many he has made, so the 3D view can play it.
  act?: { name: string; n: number };
  // Whether the last step was a sprint.
  sprinting?: boolean;
  // Recent one-off visual effects (a dust cloud where a rock landed, a teleport swirl), for the 3D view to play once.
  fx?: { n: number; name: string; area: AreaId; x: number; y: number }[];
  // Newest last.
  log: string[];
  steps: number;
  ticks: number;
  deaths: number;
  // The game as it was when this area was entered, for trying again after a defeat.
  ck?: string;
};

export const POTION_HEAL = 15;
export const POTION_PRICE = 8;
export const ANTIDOTE_PRICE = 6;
export const ELIXIR_PRICE = 12;
export const LOG_LINES = 5;
export const ROCK_DAMAGE = 12;
export const STAMINA_MAX = 10;
export const DODGE_COST = 3;
export const COMBO_MAX = 4;
export const PANEL_TIME = { W3: 22 };

export const maxHp = (level: number) => 24 + 8 * (level - 1);
export const maxMana = (s: Pick<State, "level" | "manaBonus">) => 6 + 2 * (s.level - 1) + s.manaBonus;
export const attackOf = (s: Pick<State, "level" | "weapon">) => 3 + 2 * (s.level - 1) + WEAPONS[s.weapon].atk;
export const defenseOf = (s: Pick<State, "level" | "shield" | "weapon">) => s.level + (s.shield ? 2 : 0) - (s.weapon === "axe" ? 1 : 0);
export const xpToNext = (level: number) => 12 * level;
export const potionCap = (s: Pick<State, "companion">) => (s.companion ? 10 : 4);

// ---------------------------------------------------------------------------------------- setup

// mulberry32, advancing the state's own seed.
function roll(s: { rng: number }): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle<T>(s: { rng: number }, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(roll(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The plate room's answers are the project's own: the Secret Master's hint is these numbers.
const makeQuiz = (): Quiz => ({ ans: [...PLATE_ANS], step: 0, wrong: 0, done: false });

export function newGame(seed = Date.now()): State {
  const s = {
    v: 2,
    rng: seed | 0,
    mode: "explore",
    area: "field",
    pos: { ...AREAS.field.start! },
    facing: "down",
    level: 1,
    xp: 0,
    hp: maxHp(1),
    mana: maxMana({ level: 1, manaBonus: 0 }),
    manaBonus: 0,
    stamina: STAMINA_MAX,
    special: 0,
    gold: 0,
    potions: 0,
    keys: 0,
    element: "fire",
    magic: { fire: 1, water: 1, air: 1, earth: 1, universal: 1 },
    weapon: "fists",
    weapons: ["fists"],
    items: {},
    shield: false,
    poisoned: false,
    entities: AREA_IDS.flatMap((a) => parseArea(a).entities.map((e) => ({ ...e }))),
    flags: {},
    quests: {},
    trails: [],
    hazards: [],
    timers: [],
    log: ["Mallakoth wakes in a field, a long way from anywhere."],
    steps: 0,
    ticks: 0,
    deaths: 0,
  } as unknown as State;
  s.quiz = makeQuiz();
  onEnter(s);
  return s;
}

const burst = (s: State, name: string, x: number, y: number, area: AreaId = s.area) => {
  const n = (s.fx?.at(-1)?.n ?? 0) + 1;
  s.fx = [...(s.fx ?? []), { n, name, area, x, y }].slice(-6);
};

const gesture = (s: State, name: string) => {
  s.act = { name, n: (s.act?.n ?? 0) + 1 };
};

const cue = (s: State, id: string) => {
  s.cut = { id, n: (s.cut?.n ?? 0) + 1 };
};

const say = (s: State, line: string) => {
  s.log.push(line);
  if (s.log.length > LOG_LINES) s.log.splice(0, s.log.length - LOG_LINES);
};

// ---------------------------------------------------------------------------------------- the map

export const groundAt = (s: Pick<State, "area">, x: number, y: number): Ground => groundIn(s.area, x, y);
const walkable = (s: Pick<State, "area">, x: number, y: number) => WALKABLE.includes(groundAt(s, x, y));
const inArea = (s: State) => s.entities.filter((e) => e.area === s.area);
// Signs, plates, pickups and doors-to-elsewhere are walked over; a panel that's open is a gap.
const solid = (e: Entity) => !(e.kind === "plate" || e.kind === "pickup" || e.kind === "exit" || (e.kind === "prop" && e.what === "sign")) && !(e.kind === "panel" && e.open);
const at = (s: State, x: number, y: number) => inArea(s).filter((e) => e.x === x && e.y === y);
// Open ground, or a panel that has slid open in a wall.
const passable = (s: State, x: number, y: number) => walkable(s, x, y) || at(s, x, y).some((e) => e.kind === "panel" && e.open);
export const entityAt = (s: Pick<State, "entities" | "area">, x: number, y: number) =>
  s.entities.filter((e) => e.area === s.area && e.x === x && e.y === y).sort((a, b) => Number(solid(b)) - Number(solid(a)))[0];
const find = (s: State, area: AreaId, kind: string, what: string) => s.entities.find((e) => e.area === area && e.kind === kind && e.what === what);
const remove = (s: State, e: Entity) => (s.entities = s.entities.filter((o) => o !== e && o.id !== e.id));
const spawn = (s: State, e: Omit<Entity, "id">) => s.entities.push({ ...e, id: `${e.area}:${e.kind}:${e.what}@${e.x},${e.y}` });
const STEP: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS: Dir[] = ["up", "down", "left", "right"];

// Where the boulder is on the map. Before it rolls it sits at its start; once it has run its course, nowhere.
export function boulderTile(s: State): { x: number; y: number } | undefined {
  const b = AREAS[s.area].boulder;
  if (!b || s.flags.boulderDone) return undefined;
  const pos = s.boulder?.pos ?? 0;
  return { x: b.start.x, y: Math.max(b.end.y, Math.round(b.start.y - pos)) };
}

// ---------------------------------------------------------------------------------------- the engine

export function act(prev: State, a: Action): State {
  const s = structuredClone(prev);
  if (a.type === "seen") {
    delete s.cut;
    return s;
  }
  if (s.mode === "won") {
    // After the ending, the road east to Dresden is open: Chapter 1 begins there.
    if (a.type === "continue") {
      s.mode = "explore";
      s.flags.epilogue = true;
      go(s, { area: "dresden", ...AREAS.dresden.arrive! });
      say(s, "Chapter 1 begins here. (Coming soon.)");
    }
    return s;
  }
  if (a.type === "retry") return retry(s);
  if (s.mode === "lost") return s;
  if (a.type === "element") {
    if (ELEMENTS.includes(a.el)) s.element = a.el;
    return s;
  }
  if (s.mode === "dialogue") return dialogue(s, a);
  if (a.type === "potion") return drink(s);
  if (s.mode === "battle") return fight(s, a);
  if (a.type === "move") return move(s, a.dir, !!a.sprint, !!a.keep);
  if (a.type === "turn") {
    s.facing = a.dir;
    s.sprinting = false;
    return s;
  }
  if (a.type === "dash") return dash(s);
  if (a.type === "swing") return swing(s);
  if (a.type === "wait") {
    tick(s);
    return s;
  }
  if (a.type === "equip" && s.weapons.includes(a.weapon)) {
    s.weapon = a.weapon;
    say(s, `You ready the ${WEAPONS[a.weapon].name}.`);
  }
  return s;
}

function retry(s: State): State {
  if (s.mode !== "lost") return s;
  const deaths = s.deaths + 1;
  const seed = (s.rng + 7919) | 0;
  if (!s.ck) {
    const g = newGame(seed);
    g.deaths = deaths;
    return g;
  }
  const r = JSON.parse(s.ck) as State;
  r.ck = s.ck;
  r.rng = seed;
  r.deaths = deaths;
  r.mode = "explore";
  r.hp = maxHp(r.level);
  r.mana = maxMana(r);
  r.stamina = STAMINA_MAX;
  r.poisoned = false;
  delete r.battle;
  delete r.dlg;
  r.hazards = [];
  say(r, "You come to, back where you started. A second wind.");
  onEnter(r);
  return r;
}

function drink(s: State): State {
  if (s.potions <= 0) {
    say(s, "No potions left.");
    return s;
  }
  if (s.hp >= maxHp(s.level) && !s.poisoned) {
    say(s, "You're already in good health.");
    return s;
  }
  s.potions--;
  const healed = Math.min(POTION_HEAL, maxHp(s.level) - s.hp);
  s.hp += healed;
  const cured = s.poisoned;
  s.poisoned = false;
  say(s, `You drink a potion and recover ${healed} HP${cured ? ", and the poison burns out of you" : ""}.`);
  if (s.mode === "battle") enemyTurn(s);
  return s;
}

// ---------------------------------------------------------------------------------------- conversations

const choicesOf = (s: State, id: string): Choice[] => {
  const c = NODES[id]?.choices;
  return typeof c === "function" ? c(s) : (c ?? []);
};

export function show(s: State, id: string, ref?: string, text?: string) {
  const scene = NODES[id]?.scene;
  if (scene) cue(s, scene);
  s.mode = "dialogue";
  s.dlg = { node: id, ref, ...(text !== undefined ? { text } : {}) };
}

function end(s: State) {
  delete s.dlg;
  if (s.mode === "dialogue") s.mode = "explore";
}

function dialogue(s: State, a: Action): State {
  const d = s.dlg;
  const node = d && NODES[d.node];
  if (!d || !node) {
    end(s);
    return s;
  }
  const choices = choicesOf(s, d.node);
  if (a.type === "choose" && choices.length) {
    const ch = choices[a.i];
    if (!ch) return s;
    if (ch.fx) runFx(s, ch.fx, d.ref);
    if (s.dlg !== d || s.mode !== "dialogue") return s;
    if (ch.to) show(s, ch.to, d.ref);
    else end(s);
    return s;
  }
  if (a.type === "next" && !choices.length) {
    if (node.fx) runFx(s, node.fx, d.ref);
    if (s.dlg !== d || s.mode !== "dialogue") return s;
    if (node.next) show(s, node.next, d.ref);
    else end(s);
  }
  return s;
}

// What each effect named in the story does.
function runFx(s: State, fx: string, ref?: string) {
  const [name, arg] = fx.split(":");
  switch (name) {
    case "burnLetter":
      s.flags.letterBurned = true;
      cue(s, "burn");
      say(s, "The letter burns to ash in your palm.");
      break;
    case "travel": {
      const e = s.entities.find((o) => o.id === ref);
      if (e?.to) {
        // The treehouse tile is a teleport: a swirl where you stood, and another where you land.
        const magic = e.ask === "tree_tele";
        if (magic) burst(s, "Teleport", s.pos.x, s.pos.y);
        go(s, e.to);
        if (magic) burst(s, "Teleport2", s.pos.x, s.pos.y);
      }
      break;
    }
    case "metStefan":
      s.flags.metStefan = true;
      break;
    case "metMaster":
      s.flags.metMaster = true;
      break;
    case "lost":
      say(s, "You wander around for hours and eventually realize that you are at the same location that you originally started in.");
      s.ticks += 40;
      go(s, { area: "field", x: AREAS.field.start!.x, y: AREAS.field.start!.y });
      // Hours of wandering take you into the evening, and the rain.
      s.flags.rainy = true;
      break;
    case "golemDown": {
      const g = s.entities.find((e) => e.area === "caves" && e.kind === "enemy" && e.what === "golem");
      if (g) {
        burst(s, "smoke", g.x, g.y);
        remove(s, g);
      }
      s.entities = s.entities.filter((e) => e.what !== "slab:golem");
      // The fight's dust is over with it.
      s.fx = (s.fx ?? []).filter((f) => f.name !== "Ground");
      // The hallway beyond the golem's chamber, the one that leads to the boulder, opens (the project's own scene: the slabs round the chamber, then
      // the stone door at the end of the hall, open).
      s.entities = s.entities.filter((e) => !(e.area === "caves" && e.kind === "prop" && e.what === "scenery" && (e.x === 13 || e.x === 14) && e.y === 28));
      cue(s, "golemdoor");
      s.keys++;
      s.stone = (s.stone ?? 0) + 2;
      s.hazards = [];
      s.flags.golemDown = true;
      quest(s, "golem");
      break;
    }
    case "treeHint":
      s.flags.treeHint = true;
      break;
    case "takeAxe":
      s.items.axe = true;
      say(s, "Axe added to inventory. Press E to swing it.");
      break;
    case "pigeonPoke":
      s.flags.pigeonPoked = true;
      s.hp = Math.max(1, s.hp - 1);
      show(s, "pigeon_back");
      break;
    case "openGate": {
      const gate = s.entities.find((o) => o.id === ref);
      if (gate && s.keys > 0) {
        s.keys--;
        remove(s, gate);
        say(s, "The key turns and the gate grinds open.");
      }
      break;
    }
    case "takePick": {
      // Like the axe: it just comes away from the rock into your pack, with no animation.
      const rock = s.entities.find((o) => o.id === ref);
      s.items.pickaxe = true;
      if (rock) {
        remove(s, rock);
        spawn(s, { area: rock.area, kind: "prop", what: "rock", x: rock.x, y: rock.y });
      }
      say(s, "Pickaxe added to inventory. Press E to strike the rock with it.");
      break;
    }
    case "treeDown": {
      const tree = s.entities.find((e) => e.area === s.area && e.kind === "prop" && e.what === "tree");
      if (tree) remove(s, tree);
      s.flags.treeFelled = true;
      s.gold += 12;
      s.potions = Math.min(potionCap(s), s.potions + 1);
      s.wood = (s.wood ?? 0) + 3;
      say(s, "You gather 3 pieces of wood.");
      quest(s, "woodcutter");
      // It has lost its perch and flies off.
      cue(s, "flyaway");
      break;
    }
    case "drawfJoins": {
      s.flags.drawfJoins = true;
      quest(s, "drawf");
      const d = s.entities.find((e) => e.what === "drawf");
      if (d) Object.assign(d, { area: "temple", x: 19, y: 9, id: "temple:npc:drawf@19,9" });
      break;
    }
    case "openSecret": {
      s.flags.secretOpen = true;
      const z = find(s, "temple", "panel", "secret");
      if (z) z.open = true;
      break;
    }
    case "readNote":
      s.flags.noteRead = true;
      s.gold += 5;
      quest(s, "falls");
      break;
    case "rickyNo":
      s.flags.rickyNo = true;
      break;
    case "giveRicky":
      s.companion = "ricky";
      s.ricky = { ...s.pos };
      break;
    case "vastiosLeaves": {
      s.flags.vastiosGone = true;
      const v = find(s, "temple", "npc", "vastios");
      if (v) {
        burst(s, "Teleport", v.x, v.y);
        remove(s, v);
      }
      spawn(s, { area: "temple", kind: "npc", what: "vastios", x: 34, y: 30 });
      say(s, "Vastios vanishes in a flash of white light.");
      break;
    }
    case "toSlimes":
      s.flags.trialStarted = true;
      burst(s, "Teleport", s.pos.x, s.pos.y);
      go(s, { area: "slimes", ...AREAS.slimes.arrive! });
      burst(s, "Teleport2", s.pos.x, s.pos.y);
      cue(s, "arrive");
      break;
    case "statueNo":
      s.flags.statueAsked = true;
      break;
    case "statueYes":
      awaken(s);
      break;
    case "take": {
      const w = arg as WeaponId;
      if (w === "prism") {
        delete s.items.prismGel;
        quest(s, "prism");
      } else s.flags.freeWeapon = true;
      if (!s.weapons.includes(w)) s.weapons.push(w);
      say(s, `You take the ${WEAPONS[w].name}.`);
      break;
    }
    case "buy":
      buy(s, arg);
      break;
    case "win":
      s.mode = "won";
      delete s.dlg;
      break;
  }
}

function buy(s: State, what: string) {
  const price = { potion: POTION_PRICE, antidote: ANTIDOTE_PRICE, elixir: ELIXIR_PRICE }[what] ?? 0;
  if (s.gold < price) return say(s, "Not enough gold.");
  if (what === "potion") {
    if (s.potions >= potionCap(s)) return say(s, "Your pack is full.");
    s.potions++;
  } else if (what === "antidote") {
    if (!s.poisoned) return say(s, "You're not poisoned.");
    s.poisoned = false;
  } else if (s.mana >= maxMana(s)) return say(s, "Your mana is already full.");
  else s.mana = maxMana(s);
  s.gold -= price;
  say(s, `Bought a${what === "elixir" ? "n" : ""} ${what} for ${price} gold.`);
}

// ---------------------------------------------------------------------------------------- quests and levels

function gainXp(s: State, n: number) {
  s.xp += n;
  while (s.xp >= xpToNext(s.level)) {
    s.xp -= xpToNext(s.level);
    s.level++;
    s.hp = maxHp(s.level);
    s.mana = maxMana(s);
    say(s, `Level ${s.level}! You feel stronger.`);
  }
}

export function quest(s: State, id: string) {
  const q = QUESTS.find((o) => o.id === id);
  if (!q || s.quests[id]) return;
  s.quests[id] = true;
  say(s, `Quest complete: ${q.title} (+${q.xp} XP)`);
  gainXp(s, q.xp);
}

// ---------------------------------------------------------------------------------------- moving between areas

function go(s: State, to: Spot) {
  const sameArea = s.area === to.area;
  const fromSpikes = s.area === "spikes" && to.area !== "spikes" && !!s.spike;
  s.area = to.area;
  delete s.spike;
  s.pos = { x: to.x, y: to.y };
  s.hazards = [];
  delete s.boulder;
  delete s.flags.rainy;
  s.stamina = Math.min(STAMINA_MAX, s.stamina + 2);
  s.zone = zoneAt(to.area, to.x, to.y)?.id;
  if (s.companion) s.ricky = isIndoor(to.area, to.x, to.y) ? undefined : { ...s.pos };
  if (fromSpikes && !s.flags.spikesDone) {
    s.flags.spikesDone = true;
    s.gold += 15;
    s.potions = Math.min(potionCap(s), s.potions + 1);
    quest(s, "spikes");
    show(s, "spikes_out");
  }
  // (What the spikes paid out is already in the pack before the checkpoint is taken, or dying later would take it back.)
  // The checkpoint is where you came into the area, except the spiked floor: dying there sends you back to the start of the
  // cave you came from, not straight back onto the spikes to die again.
  if (to.area !== "spikes" && !sameArea) {
    const { ck: _ck, ...rest } = s;
    s.ck = JSON.stringify(rest);
  }
  say(s, zoneAt(to.area, to.x, to.y)?.name ?? AREAS[to.area].name);
  if (groundAt(s, s.pos.x, s.pos.y) === "s") spring(s);
  onEnter(s);
}

function onEnter(s: State) {
  switch (s.area) {
    case "field":
      if (!s.flags.intro) {
        s.flags.intro = true;
        cue(s, "intro");
        show(s, "intro1");
      }
      break;
    case "caves":
      quest(s, "caves");
      break;
    case "temple":
      quest(s, "run");
      break;
    case "spikes":
      s.spike = { left: 9, total: 9 };
      s.stamina = STAMINA_MAX;
      show(s, "spikes_in");
      break;
    case "slimes":
      if (!s.flags.trialIntro) {
        s.flags.trialIntro = true;
        show(s, "vslime1");
      }
      break;
  }
}

// Walking into a named part of a big map: its name, and anything that happens the first time.
function enterZone(s: State) {
  const z = zoneAt(s.area, s.pos.x, s.pos.y);
  if (z?.id === s.zone) return;
  s.zone = z?.id;
  if (!z) return;
  say(s, z.name);
  if (z.id === "hideout") quest(s, "secret");
  if (z.id === "sanctum" && !s.flags.sanctumIntro) {
    s.flags.sanctumIntro = true;
    show(s, "sanct1");
  }
}

// ---------------------------------------------------------------------------------------- moving

function move(s: State, dir: Dir, sprint: boolean, keep = false): State {
  if (!keep) s.facing = dir;
  const double = sprint && s.stamina >= 2;
  s.sprinting = double;
  const was = s.area;
  let moved = 0;
  let spent = false;
  for (let i = 0; i < (double ? 2 : 1); i++) {
    const [dx, dy] = STEP[dir];
    const x = s.pos.x + dx;
    const y = s.pos.y + dy;
    const block = at(s, x, y).find(solid);
    // Buttons and levers sit in walls: you can press them without being able to stand there.
    if (!passable(s, x, y) && !block) break;
    if (block) {
      if (i === 0) spent = touch(s, block);
      break;
    }
    if (s.companion) s.ricky = isIndoor(s.area, x, y) ? undefined : { ...s.pos };
    s.pos = { x, y };
    s.steps++;
    moved++;
    enterZone(s);
    if (s.mode !== "explore") break;
    stepOn(s);
    if (s.mode !== "explore" || s.area !== was) break;
  }
  if (moved) {
    if (double) s.stamina = Math.max(0, s.stamina - moved);
    else if (s.steps % 2 === 0) s.stamina = Math.min(STAMINA_MAX, s.stamina + 1);
  }
  if ((moved || spent) && s.mode === "explore" && s.area === was) tick(s);
  return s;
}

// Wading into the magical spring mends everything: wounds, magic, breath, and any poison.
function spring(s: State) {
  const hurt = s.hp < maxHp(s.level) || s.mana < maxMana(s) || s.poisoned || s.stamina < STAMINA_MAX;
  s.hp = maxHp(s.level);
  s.mana = maxMana(s);
  s.stamina = STAMINA_MAX;
  s.poisoned = false;
  say(s, hurt ? "You wade into the spring. Its water is warm and humming with magic, and every hurt, every ache is gone." : "The spring's water is warm and humming with magic.");
}

const riddleSign = (e: Entity) => e.area === "caves" && e.x >= 33 && e.x <= 40 && e.y >= 8 && e.y <= 11;

function stepOn(s: State) {
  if (groundAt(s, s.pos.x, s.pos.y) === "s") spring(s);
  for (const e of at(s, s.pos.x, s.pos.y)) {
    if (e.kind === "plate") plate(s, e);
    else if (e.kind === "prop" && e.what === "sign") {
      // The riddle and its answers lie on the plate room's floor; once the door is open they have nothing more to say.
      if (s.quiz.done && riddleSign(e)) continue;
      show(s, "sign_text", e.id, e.text);
    }
    else if (e.kind === "pickup") {
      s.items[e.what] = true;
      remove(s, e);
      say(s, e.what === "pickaxe" ? "You pick up a rusty pickaxe. It's heavier than it looks." : `You pick up the ${e.what}.`);
    } else if (e.kind === "exit") {
      // The loose floorboard is Stefan's secret: you only find it once you have talked to him.
      if (e.ask === "spike_hatch" && !s.flags.metStefan) {
        show(s, "hatch_hidden");
        return;
      }
      if (e.ask) show(s, e.ask === "edge_east" && s.flags.epilogue ? "go_dresden" : e.ask, e.id);
      else if (e.to) go(s, e.to);
    }
    if (s.mode !== "explore") return;
  }
}

// Plates in the plate room are "p:column:row", columns counted from the east door, rows from the bottom.
// A column's safe plate is the one the Secret Master's hint names; any other releases the poison.
function plate(s: State, e: Entity) {
  if (e.what.startsWith("t:")) return trigger(s, e);
  const q = s.quiz;
  if (q.done) return;
  const [, c, r] = e.what.split(":");
  const col = Number(c);
  if (Number(r) === q.ans[col]) {
    if (col === q.step) {
      q.step++;
      say(s, "Click. The plate holds.");
      if (q.step >= 4) {
        q.done = true;
        for (const p of s.entities) if (p.area === s.area && p.kind === "panel" && p.what === "plates") p.open = true;
        say(s, "The far door grinds open.");
        quest(s, "plates");
      }
    }
    return;
  }
  q.wrong++;
  if (q.wrong === 1) {
    s.poisoned = true;
    s.hp = Math.max(1, s.hp - 6);
    say(s, "Wrong! Green gas hisses from the floor. You're poisoned, and you won't heal on your own until you're cured.");
  } else {
    s.hp = 0;
    s.mode = "lost";
    say(s, "Wrong again. The poison floods your veins, and the cave goes dark.");
  }
}

// Tiles that do something when stepped on.
function trigger(s: State, e: Entity) {
  switch (e.what.slice(2)) {
    case "master":
      if (!s.flags.masterSeen) {
        s.flags.masterSeen = true;
        show(s, "sm_first1");
      }
      break;
    case "boulder":
      startBoulder(s);
      break;
    case "golemTrap":
      trapGolem(s);
      break;
    case "golemQuest":
      if (!s.flags.golemWarned) {
        s.flags.golemWarned = true;
        say(s, "The air ahead is heavy and still. Something very large sleeps down there.");
      }
      break;
  }
}

// Slabs crash down to seal a way, listed in the area's definition.
function seal(s: State, name: string) {
  for (const c of AREAS[s.area].seals?.[name] ?? []) spawn(s, { area: s.area, kind: "panel", what: `slab:${name}`, x: c.x, y: c.y });
}

function startBoulder(s: State) {
  if (!AREAS[s.area].boulder || s.boulder || s.flags.boulderDone) return;
  s.boulder = { pos: 0 };
  s.flags.boulderStarted = true;
  cue(s, "boulder");
  seal(s, "boulder");
  say(s, "Slabs crash down behind you. Far down the hall, something enormous starts to roll. Run! Keep moving, and you can outrun it. (Sprinting is faster still.)");
}

function trapGolem(s: State) {
  if (s.flags.golemAwake || s.flags.golemDown) return;
  s.flags.golemAwake = true;
  cue(s, "golem");
  seal(s, "golem");
  say(s, "Slabs crash shut behind you. At the far end of the hollow, two eyes flare orange.");
}

// ---------------------------------------------------------------------------------------- bumping into things

function touch(s: State, e: Entity): boolean {
  switch (e.kind) {
    case "enemy":
      if (e.what === "golem") {
        if (s.items.pickaxe) gesture(s, "pick_attack1");
        show(s, s.items.pickaxe ? "golem_down" : "golem_nope");
      }
      else startFight(s, e);
      return false;
    case "npc":
      show(s, nodeFor(s, e), e.id);
      return false;
    case "chest":
      return openChest(s, e);
    case "pot":
      // A pot is smashed with E, not by walking into it.
      say(s, "A clay pot. Press E to smash it.");
      return false;
    case "gate":
      // With a key it asks first (the project's own script does it when you interact), then the gate swings open on its animation.
      if (s.keys > 0) {
        show(s, "gate_open", e.id);
        return false;
      }
      say(s, "The gate is locked. There must be a key somewhere.");
      return false;
    case "panel":
      if (e.what === "door") {
        e.open = true;
        say(s, "The temple door swings open.");
        return true;
      }
      if (e.what === "fake") {
        show(s, "fake_altar");
        return false;
      }
      say(s, e.what === "secret" ? "Solid rock." : e.what.startsWith("slab") ? "A slab of stone, sealed tight." : e.what === "w3" ? "A heavy stone door. There must be a way to open it." : "A stone panel, shut tight.");
      return false;
    case "button":
      press(s, e);
      return true;
    case "lever":
      pull(s, e);
      return true;
    case "crystal":
      return touchCrystal(s, e);
    case "prop":
      return touchProp(s, e);
  }
  return false;
}

function nodeFor(s: State, e: Entity): string {
  switch (e.what) {
    case "master":
      if (s.area === "caves") return s.flags.metMaster ? "sm_again" : "sm_first1";
      if (s.area === "treehouse") return s.flags.treehouseMet ? "tree_menu" : ((s.flags.treehouseMet = true), "tree1");
      if (s.area === "slimes") return s.flags.treeHint ? "sm_slimes2" : "sm_slimes";
      if (s.companion) return "sm_has";
      if (s.flags.rickyNo) return "sm_declined";
      return s.flags.metMaster ? "sm_ret1" : "sm_h1";
    case "drawf":
      return s.flags.drawfJoins ? "drawf_advice" : "drawf1";
    case "vastios":
      if (s.zone === "sanctum") return s.flags.leversExplained ? "vl_remind" : ((s.flags.leversExplained = true), "vl1");
      return s.area === "slimes" ? "vslime_again" : "vvalley1";
    case "wilfred":
      return "wilfred1";
    case "stefan":
      return "stefan1";
    case "alexis":
      return "alexis1";
    case "clavicus":
      return "clavicus1";
    case "joshua":
      return "joshua1";
  }
  return "drawf_advice";
}

function openChest(s: State, e: Entity): boolean {
  if (e.done) {
    say(s, "The chest is empty.");
    return false;
  }
  const { loot, text } = CHESTS[e.what];
  e.done = true;
  s.potions = Math.min(potionCap(s), s.potions + (loot.potion ?? 0));
  s.gold += loot.gold ?? 0;
  if (loot.shield) s.shield = true;
  say(s, text);
  return false;
}

function smash(s: State, e: Entity): boolean {
  const total = POT_LOOT.reduce((n, p) => n + p.weight, 0);
  let r = roll(s) * total;
  const pick = POT_LOOT.find((p) => (r -= p.weight) < 0) ?? POT_LOOT[0];
  remove(s, e);
  s.gold += pick.gold ?? 0;
  if (pick.potion && s.potions < potionCap(s)) s.potions++;
  say(s, `Crash! ${pick.text}`);
  return true;
}

function touchCrystal(s: State, e: Entity): boolean {
  const el = e.what as Element;
  remove(s, e);
  s.magic[el]++;
  s.manaBonus += el === "universal" ? 2 : 1;
  s.mana = maxMana(s);
  s.flags[`crystal_${el}`] = true;
  say(s, `The ${el === "universal" ? "clear" : el} crystal dissolves into you. Your ${el === "universal" ? "universal" : el} magic grows stronger.`);
  if (ELEMENTS.every((x) => s.flags[`crystal_${x}`])) quest(s, "crystals");
  return false;
}

// The old tree: the pigeon on its branch pecks you before you can swing, then three good chops fell it.
function chopTree(s: State, e: Entity): boolean {
  if (!s.flags.pigeonPoked) {
    show(s, "tree_poke");
    return false;
  }
  // Now and then it dives again before the axe comes down, so a swing is not always a chop.
  if (roll(s) < 0.3) {
    show(s, "tree_repeck");
    return false;
  }
  gesture(s, "swing_axe");
  e.hp = (e.hp ?? 3) - 1;
  if (e.hp > 0) {
    say(s, "Chop! Bark flies. The tree shudders.");
    return true;
  }
  show(s, "tree_down");
  return true;
}

// E: swing the axe at whatever is in front. Only the old tree cares; everything else just feels the breeze.
function swing(s: State): State {
  const [dx, dy] = STEP[s.facing];
  const front = at(s, s.pos.x + dx, s.pos.y + dy);
  // The golem is not to be smacked bare-handed: say so; with the pickaxe, the blow is the same one walking into it makes.
  const golem = front.find((e) => e.kind === "enemy" && e.what === "golem");
  if (golem) {
    if (!s.items.pickaxe) {
      say(s, "The golem's hide is solid rock; your fists would break long before it does. One of those skeletons might have left a tool at its feet.");
      return s;
    }
    gesture(s, "pick_attack1");
    show(s, "golem_down");
    return s;
  }
  // A pot is kicked to pieces (the project's own animation), tool or no tool.
  const pot = front.find((e) => e.kind === "pot");
  if (pot) {
    gesture(s, "pot_break");
    smash(s, pot);
    tick(s);
    return s;
  }
  if (!s.items.axe && !s.items.pickaxe) {
    say(s, "You have nothing to swing.");
    return s;
  }
  const hit = front.find((e) => e.kind === "prop" && (e.what === "tree" || e.what === "treeblock"));
  // Any of the tree's four cells is the tree.
  const target = hit && (hit.what === "tree" ? hit : find(s, s.area, "prop", "tree"));
  if (target) {
    if (!s.items.axe) {
      say(s, "You have no axe to swing at the tree.");
      return s;
    }
    if (chopTree(s, target) && s.mode === "explore") tick(s);
    return s;
  }
  const rock = front.find((e) => e.kind === "prop" && e.what === "rock");
  if (rock) {
    if (!s.items.pickaxe) {
      say(s, "You have no pickaxe to swing at the rock.");
      return s;
    }
    chopRock(s, rock);
    tick(s);
    return s;
  }
  // Nothing in front: swing whichever you carry (the axe, if you carry both).
  gesture(s, s.items.axe ? "swing_axe" : "pick_attack1");
  say(s, s.items.axe ? "You swing the axe through the air." : "You swing the pickaxe through the air.");
  tick(s);
  return s;
}

// The rock the pickaxe was in: three good blows with the pickaxe, and it crumbles into stone.
function chopRock(s: State, e: Entity) {
  gesture(s, "pick_attack1");
  e.hp = (e.hp ?? 3) - 1;
  if (e.hp > 0) {
    say(s, "Clang! Chips of stone fly.");
    return;
  }
  remove(s, e);
  s.stone = (s.stone ?? 0) + 3;
  say(s, "The rock crumbles to rubble. You gather 3 stone.");
}

function touchProp(s: State, e: Entity): boolean {
  if (e.what.startsWith("shelf:")) {
    gesture(s, "grab_book");
    const i = Math.min(LORE.length - 1, Number(e.what.split(":")[1]));
    s.flags[`lore${i}`] = true;
    show(s, "lore", undefined, LORE[i]);
    if (LORE.every((_, k) => s.flags[`lore${k}`])) quest(s, "scholar");
    return false;
  }
  switch (e.what) {
    case "lost":
      show(s, "lost1");
      break;
    case "table":
      if (!s.flags.noteRead) show(s, "table1");
      else show(s, "note_q", undefined, NOTE_QUIPS[Math.floor(roll(s) * NOTE_QUIPS.length)]);
      break;
    case "scenery":
      break;
    case "pickrock":
      // A pickaxe wedged in a rock: take it, if you want it.
      show(s, "pick_take", e.id);
      break;
    case "rock":
      say(s, s.items.pickaxe ? "A solid rock. Press E to strike it with your pickaxe." : "A solid rock. You will need a tool for it.");
      break;
    case "deadkeeper":
      show(s, "keeper_dead");
      break;
    case "fakealtar":
      show(s, "fake_altar");
      break;
    case "flame":
      gesture(s, "touch_flame");
      show(s, "flame1");
      break;
    case "stump":
    case "stumpblock":
      show(s, s.items.axe ? "axe_stump" : "axe_get");
      break;
    case "trailsign":
      show(s, "trail_sign");
      break;
    case "tree":
    case "treeblock":
      // The axe is swung on purpose (E), not by walking into the tree.
      if (s.items.axe) say(s, "The old tree. Press E to swing your axe at it.");
      else show(s, "tree_nope");
      return false;
    case "statue":
      show(s, s.flags.blade ? "statue_done" : s.flags.statueAsked ? "statue_again" : "statue1");
      break;
  }
  return false;
}

// ---------------------------------------------------------------------------------------- buttons, levers and timed doors

function openPanel(s: State, area: AreaId, what: string, time?: number) {
  const p = find(s, area, "panel", what);
  if (!p) return;
  p.open = true;
  s.timers = s.timers.filter((t) => t.id !== `panel:${area}:${what}`);
  if (time) s.timers.push({ id: `panel:${area}:${what}`, left: time });
}

// The hall's buttons, as the project built them: the blue button at the bottom of the left wall opens a block in
// the dividing wall; the gold button beyond it arms the red button at the bottom of the right wall; the red
// button opens the sanctum door, but only for a while. Every other button is a false flame.
function press(s: State, e: Entity) {
  gesture(s, "push_button");
  switch (e.what) {
    case "mountain":
      if (s.flags.secretOpen) show(s, "mtn_done");
      else show(s, "mtn_btn");
      return;
    case "L1":
      openPanel(s, "temple", "w1");
      say(s, "Click. A heavy block in the dividing wall slides aside.");
      return;
    case "gold":
      s.flags.armed = true;
      say(s, "The gold button sinks. Somewhere across the hall, a mechanism wakes.");
      return;
    case "R1":
      if (!s.flags.armed) {
        say(s, "The red button doesn't give. Something else must wake it first.");
        return;
      }
      // The false altar slides aside for good; the sanctum door behind it opens, but only for a while.
      openPanel(s, "temple", "fake");
      openPanel(s, "temple", "w3", PANEL_TIME.W3);
      s.flags.puzzleDone = true;
      say(s, "The red button sinks. The false altar slides aside and the sanctum door grinds open. It won't stay open long.");
      quest(s, "flame");
      return;
    case "decoy":
      s.hp = Math.max(1, s.hp - 4);
      say(s, "A false flame! Fire licks out of the wall and singes you for 4. Perhaps a different button.");
      return;
  }
}

function pull(s: State, e: Entity) {
  gesture(s, "Lever_Grab");
  if (!s.flags.leversExplained) {
    say(s, e.what === "raise" ? "The lever seems to magically deny you. Maybe talking to Vastios would fix that." : "The lever didn't budge. Maybe talk to Vastios first.");
    return;
  }
  if (e.what === "raise") {
    if (s.flags.altarUp) return say(s, "The altar is already raised.");
    s.flags.altarUp = true;
    cue(s, "altar");
    spawn(s, { area: "temple", kind: "chest", what: "altar", x: 21, y: 6 });
    say(s, "Stone grinds. The altar rises, and a hidden chest slides out of its base.");
  } else {
    const c = find(s, "temple", "chest", "altar");
    if (c) {
      remove(s, c);
      say(s, "The altar sinks back. The chest goes with it.");
    }
    s.flags.leversDone = true;
    openPanel(s, "temple", "w3");
    say(s, "The way out grinds open for good.");
    quest(s, "levers");
  }
}

function tickTimers(s: State) {
  for (const t of s.timers) {
    t.left--;
    if (t.left > 0) continue;
    const [, area, what] = t.id.split(":");
    const p = find(s, area as AreaId, "panel", what);
    if (!p) continue;
    // Never shut a door on someone standing in it.
    if (s.area === area && s.pos.x === p.x && s.pos.y === p.y) {
      t.left = 1;
      continue;
    }
    p.open = false;
    if (s.area === area) say(s, "A panel grinds shut.");
  }
  s.timers = s.timers.filter((t) => t.left > 0);
}

// ---------------------------------------------------------------------------------------- the passing of time

function tick(s: State) {
  s.ticks++;
  if (!s.poisoned && s.hp < maxHp(s.level) && s.ticks % 6 === 0) s.hp++;
  if (s.mana < maxMana(s) && s.ticks % 3 === 0) s.mana++;
  for (const t of s.trails) if (t.area === s.area) t.ttl--;
  s.trails = s.trails.filter((t) => t.ttl > 0);
  tickTimers(s);
  moveEnemies(s);
  if (s.mode !== "explore") return;
  rocks(s);
  if (s.mode !== "explore") return;
  spikes(s);
  if (s.mode !== "explore") return;
  rollBoulder(s);
}

// The golem hurls rocks every third tick: one where you stand and one two steps ahead of you. Each
// shows a shadow for two ticks before it lands, so they can always be dodged.
function rocks(s: State) {
  const golem = s.entities.find((e) => e.area === s.area && e.kind === "enemy" && e.what === "golem");
  if (!golem || !s.flags.golemAwake || Math.abs(golem.x - s.pos.x) + Math.abs(golem.y - s.pos.y) > 18) {
    // No fight on: no rocks in the air, no red squares left on the floor.
    if (s.hazards.length) s.hazards = [];
    return;
  }
  for (const h of s.hazards) h.fuse--;
  const landing = s.hazards.filter((h) => h.fuse <= 0);
  s.hazards = s.hazards.filter((h) => h.fuse > 0);
  for (const h of landing) burst(s, "Ground", h.x, h.y);
  if (landing.some((h) => h.x === s.pos.x && h.y === s.pos.y)) {
    s.hp = Math.max(0, s.hp - ROCK_DAMAGE);
    say(s, `A rock slams into you for ${ROCK_DAMAGE}!`);
    if (s.hp <= 0) {
      s.mode = "lost";
      say(s, "The cave goes dark.");
      return;
    }
  }
  if (s.ticks % 3 !== 0) return;
  // Rocks come down at random on the floor around you, each one shown by a red square a moment before; now and then one has your own square.
  const targets: { x: number; y: number }[] = [];
  if (roll(s) < 0.4) targets.push({ x: s.pos.x, y: s.pos.y });
  for (let i = 0; i < 4; i++) {
    const x = s.pos.x + Math.floor(roll(s) * 7) - 3;
    const y = s.pos.y + Math.floor(roll(s) * 7) - 3;
    if (!targets.some((t) => t.x === x && t.y === y)) targets.push({ x, y });
  }
  for (const t of targets) if (walkable(s, t.x, t.y) && !s.hazards.some((h) => h.x === t.x && h.y === t.y)) s.hazards.push({ ...t, fuse: 2 });
  say(s, "The golem hurls rocks! Watch the shadows.");
}

// The boulder rolls up the long hall at a steady pace, slower than walking, so you can outrun it on foot (and faster still by sprinting). Anyone in
// the hall that it catches is crushed; the way out at the far end is the only safe place.
// The spiked floor rises a few ticks after you step in, and anyone still standing on it is lost.
function spikes(s: State) {
  if (!s.spike || s.area !== "spikes") return;
  s.spike.left--;
  if (s.spike.left > 0) return;
  s.hp = 0;
  s.mode = "lost";
  say(s, "The floor erupts in spikes.");
}

function rollBoulder(s: State) {
  const b = AREAS[s.area].boulder;
  if (!s.boulder || !b) return;
  s.boulder.pos += b.speed;
  const ahead = b.start.y - s.pos.y;
  if (s.pos.x >= b.x0 && s.pos.x <= b.x1 && ahead >= 0 && s.boulder.pos >= ahead) {
    s.hp = 0;
    s.mode = "lost";
    say(s, "The boulder rolls over you. You never stood a chance.");
  } else if (s.boulder.pos >= b.start.y - b.end.y) {
    delete s.boulder;
    s.flags.boulderDone = true;
  } else if (Math.floor(s.boulder.pos) % 5 === 0 && Math.floor(s.boulder.pos - b.speed) % 5 !== 0) say(s, "The rumbling is getting closer!");
}

// ---------------------------------------------------------------------------------------- enemies on the map

function moveEnemies(s: State) {
  for (const e of inArea(s)) {
    if (e.kind !== "enemy") continue;
    const def = ENEMIES[e.what as EnemyKind];
    if (!def || def.ai.mode === "still") continue;
    if (e.frozen) {
      e.frozen--;
      continue;
    }
    if (s.ticks % def.ai.every !== 0) continue;
    const dx = s.pos.x - e.x;
    const dy = s.pos.y - e.y;
    const near = Math.abs(dx) + Math.abs(dy);
    let order: Dir[];
    if (def.ai.mode === "chase" && near <= def.ai.range) {
      const horiz: Dir = dx > 0 ? "right" : "left";
      const vert: Dir = dy > 0 ? "down" : "up";
      order = Math.abs(dx) >= Math.abs(dy) ? [horiz, vert] : [vert, horiz];
      if (dx === 0) order = [vert];
      if (dy === 0) order = [horiz];
    } else if (roll(s) < 0.5) continue;
    else order = shuffle(s, [...DIRS]).slice(0, 2);
    for (const d of order) {
      const x = e.x + STEP[d][0];
      const y = e.y + STEP[d][1];
      if (x === s.pos.x && y === s.pos.y) {
        startFight(s, e);
        return;
      }
      if (!enemyCanEnter(s, x, y)) continue;
      e.x = x;
      e.y = y;
      stepOnTrail(s, e);
      break;
    }
  }
}

function enemyCanEnter(s: State, x: number, y: number): boolean {
  if (!walkable(s, x, y) || groundAt(s, x, y) === "w") return false;
  if (s.trails.some((t) => t.area === s.area && t.x === x && t.y === y && t.el === "earth")) return false;
  return !at(s, x, y).length;
}

function stepOnTrail(s: State, e: Entity) {
  const t = s.trails.find((o) => o.area === s.area && o.x === e.x && o.y === e.y);
  if (!t) return;
  const def = ENEMIES[e.what as EnemyKind];
  switch (t.el) {
    case "fire":
      hurtEnemy(s, e, 5 + 2 * s.magic.fire, `The ${def.name} runs into your flames`);
      break;
    case "water":
      e.frozen = 3;
      say(s, `The ${def.name} freezes on the ice.`);
      break;
    case "air": {
      e.frozen = 1;
      const px = e.x + Math.sign(e.x - s.pos.x);
      const py = e.y + Math.sign(e.y - s.pos.y);
      if (enemyCanEnter(s, px, py)) Object.assign(e, { x: px, y: py });
      say(s, `A gust throws the ${def.name} back.`);
      break;
    }
    case "universal":
      e.frozen = 2;
      say(s, `The ${def.name} is dazzled.`);
      break;
  }
}

function hurtEnemy(s: State, e: Entity, dmg: number, text: string) {
  const def = ENEMIES[e.what as EnemyKind];
  e.hp = (e.hp ?? def.hp) - dmg;
  if (e.hp > 0) return say(s, `${text} for ${dmg}.`);
  remove(s, e);
  say(s, `${text}, and it's gone.`);
  reward(s, e.what as EnemyKind);
}

// ---------------------------------------------------------------------------------------- the dash

function dash(s: State): State {
  if (s.spike) {
    say(s, "There's no time to gather magic: run!");
    return s;
  }
  if (s.boulder) {
    say(s, "There's no time to gather magic with a boulder behind you.");
    return s;
  }
  if (s.mana < DASH_COST) {
    say(s, "Not enough mana to dash.");
    return s;
  }
  const [dx, dy] = STEP[s.facing];
  let n = 0;
  for (let i = 1; i <= DASH_LENGTH; i++) {
    const x = s.pos.x + dx * i;
    const y = s.pos.y + dy * i;
    if (!passable(s, x, y) || at(s, x, y).filter((o) => !(o.kind === "prop" && o.what === "sign")).length) break;
    n = i;
  }
  if (n === 0) {
    say(s, "Something blocks the dash.");
    return s;
  }
  s.mana -= DASH_COST;
  for (let i = 0; i < n; i++) {
    const x = s.pos.x + dx * i;
    const y = s.pos.y + dy * i;
    s.trails = s.trails.filter((t) => !(t.area === s.area && t.x === x && t.y === y));
    s.trails.push({ area: s.area, x, y, el: s.element, ttl: TRAIL_TURNS });
  }
  if (s.companion) s.ricky = isIndoor(s.area, s.pos.x + dx * n, s.pos.y + dy * n) ? undefined : { x: s.pos.x + dx * (n - 1), y: s.pos.y + dy * (n - 1) };
  s.pos = { x: s.pos.x + dx * n, y: s.pos.y + dy * n };
  s.steps += n;
  say(s, `You dash, leaving ${s.element === "universal" ? "light" : s.element} in your wake.`);
  tick(s);
  return s;
}

// ---------------------------------------------------------------------------------------- fighting

const hitRoll = (s: State, atk: number, def: number) => Math.max(1, atk + Math.floor(roll(s) * 3) - def);

function startFight(s: State, e: Entity) {
  const kind = e.what as EnemyKind;
  const def = ENEMIES[kind];
  s.mode = "battle";
  s.battle = { enemyId: e.id, kind, hp: e.hp ?? def.hp, maxHp: def.hp, guarding: false, burn: 0, stun: 0, intent: "strike", combo: 0, stagger: 0, broken: 0, last: { hero: "idle", foe: "idle" }, turn: 0 };
  say(s, def.taunt);
  chooseIntent(s, s.battle);
}

const INTENT_TEXT: Record<Intent, string> = { strike: "readies a strike.", heavy: "is winding up a HEAVY blow!", swift: "is about to flurry!" };

// Slimes mostly strike, now and then wind up something heavy or dart in twice. The Great Slime gets quicker as it shrinks.
function chooseIntent(s: State, b: Battle) {
  const small = b.kind === "bigslime" && b.hp / b.maxHp < 1 / 3;
  const w: Record<Intent, number> = b.kind === "bigslime" ? (small ? { strike: 30, heavy: 10, swift: 60 } : { strike: 40, heavy: 40, swift: 20 }) : { strike: 55, heavy: 25, swift: 20 };
  let r = roll(s) * (w.strike + w.heavy + w.swift);
  b.intent = (["strike", "heavy", "swift"] as Intent[]).find((k) => (r -= w[k]) < 0) ?? "strike";
  say(s, `The ${ENEMIES[b.kind].name} ${INTENT_TEXT[b.intent]}`);
}

function charge(s: State) {
  if (s.flags.blade) s.special = Math.min(SPECIAL_MAX, s.special + 1);
}

// Landing a blow: it hurts, it builds the combo, and it soaks into the stagger bar.
function land(s: State, b: Battle, dmg: number) {
  b.hp -= dmg;
  b.stagger += dmg;
}

function fight(s: State, a: Action): State {
  const b = s.battle!;
  const foe = ENEMIES[b.kind];
  b.guarding = false;
  b.last = { hero: "idle", foe: "idle" };
  b.turn++;
  // Reeling: the enemy lost its move after a Break, and this blow lands extra hard before it recovers.
  const reeling = b.broken > 0;
  let dodging = false;
  if (a.type === "attack") {
    const pierce = s.weapon === "polearm" ? 2 : 0;
    let dmg = hitRoll(s, attackOf(s), Math.max(0, foe.def - pierce)) + Math.min(b.combo, COMBO_MAX);
    if (s.weapon === "prism") dmg += 2;
    if (reeling) dmg = Math.floor(dmg * 1.5);
    land(s, b, dmg);
    b.combo++;
    say(s, `You hit the ${foe.name} for ${dmg}${b.combo > 1 ? ` (combo x${b.combo})` : ""}${reeling ? ", right through its guard" : ""}.`);
    if (s.weapon === "bow" && roll(s) < 0.35 && b.hp > 0) {
      const extra = hitRoll(s, attackOf(s), foe.def);
      land(s, b, extra);
      say(s, `A second arrow follows for ${extra}!`);
    }
    charge(s);
    b.last.hero = "attack";
  } else if (a.type === "special") {
    if (!s.flags.blade || s.special < SPECIAL_MAX) {
      say(s, "The blade isn't charged yet.");
      return s;
    }
    const dmg = attackOf(s) * 3;
    s.special = 0;
    land(s, b, dmg);
    b.combo += 2;
    say(s, `Flame Strike! The Lightbringer blade blazes for ${dmg}.`);
    b.last.hero = "attack";
  } else if (a.type === "spell") {
    if (!cast(s, b)) return s;
    b.last.hero = "cast";
  } else if (a.type === "guard") {
    b.guarding = true;
    say(s, "You raise your guard.");
    b.last.hero = "guard";
  } else if (a.type === "dodge") {
    if (s.stamina < DODGE_COST) {
      say(s, "You're too winded to dodge.");
      return s;
    }
    s.stamina -= DODGE_COST;
    dodging = true;
    say(s, "You set your feet, ready to move.");
    b.last.hero = "dodge";
  } else if (a.type === "flee") {
    if (foe.boss) say(s, "There's no escaping this one.");
    else if (roll(s) < 0.5) {
      const e = s.entities.find((o) => o.id === b.enemyId);
      if (e) {
        e.hp = b.hp;
        e.frozen = 3;
      }
      s.mode = "explore";
      delete s.battle;
      say(s, "You slip away.");
      return s;
    } else say(s, "You couldn't get away.");
  } else return s;
  if (b.hp > 0 && b.burn > 0) {
    b.burn--;
    b.hp -= 2;
    say(s, `The flames bite the ${foe.name} for 2.`);
  }
  if (b.hp <= 0) return win(s);
  // Enough soaked-up damage breaks the enemy's stance: it loses its next move, and takes more from the next blow.
  if (b.stagger >= b.maxHp * (foe.boss ? 0.4 : 0.5) && b.broken === 0) {
    b.broken = 1;
    b.stagger = 0;
    say(s, `Break! The ${foe.name} reels.`);
  }
  // Stagger drains away between exchanges, so it takes a run of hits to Break something.
  b.stagger = Math.floor(b.stagger * 0.75);
  return enemyTurn(s, dodging);
}

function cast(s: State, b: Battle): boolean {
  const el = s.element;
  const sp = SPELLS[el];
  if (s.mana < sp.cost) {
    say(s, "Not enough mana.");
    return false;
  }
  s.mana -= sp.cost;
  const p = Math.min(4, s.magic[el]);
  const r = Math.floor(roll(s) * 3);
  const foe = ENEMIES[b.kind];
  let dmg = 0;
  switch (el) {
    case "fire":
      dmg = 5 + 3 * p + r;
      b.burn = 2;
      break;
    case "water": {
      dmg = 3 + 2 * p + r;
      const heal = Math.min(3 + p, maxHp(s.level) - s.hp);
      s.hp += heal;
      if (roll(s) < 0.35) b.stun = 1;
      break;
    }
    case "air":
      dmg = 4 + 2 * p + r;
      break;
    case "earth":
      dmg = 4 + 2 * p + r;
      b.guarding = true;
      break;
    case "universal": {
      dmg = 8 + 4 * p + r;
      s.hp = Math.min(maxHp(s.level), s.hp + 4);
      break;
    }
  }
  land(s, b, dmg);
  b.combo++;
  say(s, `${sp.name}! ${foe.name} takes ${dmg}.`);
  charge(s);
  return true;
}

const rest = (s: State) => {
  s.stamina = Math.min(STAMINA_MAX, s.stamina + 1);
};

function enemyTurn(s: State, dodging = false): State {
  const b = s.battle!;
  const foe = ENEMIES[b.kind];
  if (b.stun > 0) {
    b.stun--;
    say(s, `The ${foe.name} is stunned and loses its turn.`);
    b.last.foe = "stun";
    chooseIntent(s, b);
    rest(s);
    return s;
  }
  if (b.broken > 0) {
    say(s, `The ${foe.name} is reeling and can't act.`);
    b.last.foe = "stun";
    chooseIntent(s, b);
    rest(s);
    return s;
  }
  const intent = b.intent;
  // Slipping aside works best against a slow wind-up, worst against a flurry. A clean dodge earns an opening.
  if (dodging) {
    const chance = { strike: 0.6, swift: 0.45, heavy: 0.8 }[intent];
    if (roll(s) < chance) {
      say(s, `You slip aside, and the ${foe.name} hits nothing but air. An opening!`);
      b.combo = Math.min(COMBO_MAX, b.combo + 2);
      b.last.foe = "attack";
      chooseIntent(s, b);
      rest(s);
      return s;
    }
    say(s, "You stumble: the dodge fails.");
  }
  // The Great Slime shrinks as it is hurt: it hits softer, but more often, once it's small.
  const ratio = b.hp / b.maxHp;
  const scale = b.kind === "bigslime" ? 0.25 + 0.75 * ratio : 1;
  const hits = (intent === "swift" ? 2 : 1) * (b.kind === "bigslime" && ratio < 1 / 3 ? 2 : 1);
  const mult = intent === "heavy" ? 1.8 : intent === "swift" ? 0.6 : 1;
  const guarded = b.guarding && !dodging;
  b.last.foe = "attack";
  // A guard against a quick blow can turn it aside and strike back.
  if (guarded && intent !== "heavy" && roll(s) < 0.3) {
    const back = Math.ceil(attackOf(s) * 0.6);
    land(s, b, back);
    say(s, `You turn the ${foe.name}'s blow aside and strike back for ${back}!`);
    if (b.hp <= 0) return win(s);
    chooseIntent(s, b);
    rest(s);
    return s;
  }
  for (let i = 0; i < hits; i++) {
    let dmg = Math.max(1, Math.round(hitRoll(s, foe.atk, defenseOf(s)) * mult * scale));
    if (guarded) dmg = Math.ceil(dmg * (intent === "heavy" ? 0.4 : 0.5));
    s.hp = Math.max(0, s.hp - dmg);
    // A heavy blow knocks you out of your rhythm; a flurry chips at it; a plain strike doesn't.
    b.combo = intent === "heavy" ? 0 : intent === "swift" ? Math.max(0, b.combo - 1) : b.combo;
    say(s, `The ${foe.name} ${intent === "heavy" ? "slams" : "hits"} you for ${dmg}.`);
    if (s.hp <= 0) {
      s.mode = "lost";
      delete s.battle;
      say(s, "You fall. The journey ends here.");
      return s;
    }
  }
  b.guarding = false;
  chooseIntent(s, b);
  rest(s);
  return s;
}

function reward(s: State, kind: EnemyKind) {
  const foe = ENEMIES[kind];
  s.gold += foe.gold;
  say(s, `The ${foe.name} is defeated. +${foe.xp} XP, +${foe.gold} gold.`);
  gainXp(s, foe.xp);
  if (kind === "rainbow") {
    s.items.prismGel = true;
    say(s, "It leaves behind a jar of shimmering Prism Gel. Someone would love to see this.");
  }
  if (SLIME_COLORS.includes(kind as never) && s.flags.wave && !s.flags.bigSpawned && slimesLeft(s) === 0) {
    s.flags.bigSpawned = true;
    quest(s, "slimes");
    const statue = find(s, "slimes", "prop", "statue");
    spawn(s, { area: "slimes", kind: "enemy", what: "bigslime", x: statue?.x ?? 17, y: (statue?.y ?? 17) + 3 });
    say(s, "The fields fall silent. Then the ground begins to shake.");
  }
}

function win(s: State): State {
  const b = s.battle!;
  s.entities = s.entities.filter((e) => e.id !== b.enemyId);
  delete s.battle;
  s.mode = "explore";
  reward(s, b.kind);
  if (b.kind === "bigslime") {
    quest(s, "great");
    // Months later, in the sanctum.
    go(s, { area: "finale", ...AREAS.finale.arrive! });
    cue(s, "oath");
    show(s, "oath0");
  }
  return s;
}

export const slimesLeft = (s: Pick<State, "entities">) => s.entities.filter((e) => e.area === "slimes" && e.kind === "enemy" && e.what !== "bigslime").length;

// The Lightbringer blade, and then the slimes: a random mix, mostly green, almost never rainbow.
function awaken(s: State) {
  cue(s, "sword");
  s.flags.blade = true;
  s.flags.wave = true;
  s.weapon = "lightbringer";
  if (!s.weapons.includes("lightbringer")) s.weapons.push("lightbringer");
  s.special = 0;
  say(s, "Lightbringer blade acquired!");
  say(s, "New quest: Liberating the Slime Fields.");
  const free: { x: number; y: number }[] = [];
  const { width, height } = parseArea("slimes");
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++)
      if (walkable(s, x, y) && !at(s, x, y).length && Math.abs(x - s.pos.x) + Math.abs(y - s.pos.y) >= 4) free.push({ x, y });
  shuffle(s, free);
  const total = SLIME_COLORS.reduce((n, c) => n + SLIME_WEIGHTS[c], 0);
  for (const spot of free.slice(0, SLIME_WAVE)) {
    let r = roll(s) * total;
    const color = SLIME_COLORS.find((c) => (r -= SLIME_WEIGHTS[c]) < 0) ?? "green";
    spawn(s, { area: "slimes", kind: "enemy", what: color, x: spot.x, y: spot.y });
  }
}

// ---------------------------------------------------------------------------------------- saving

// Whether a saved game is one this version can still read.
export function isState(v: unknown): v is State {
  const s = v as State | null;
  return (
    !!s &&
    typeof s === "object" &&
    s.v === 2 &&
    typeof s.rng === "number" &&
    ["explore", "battle", "dialogue", "won", "lost"].includes(s.mode) &&
    typeof s.area === "string" &&
    s.area in AREAS &&
    typeof s.pos?.x === "number" &&
    typeof s.pos?.y === "number" &&
    typeof s.level === "number" &&
    typeof s.hp === "number" &&
    Array.isArray(s.entities) &&
    Array.isArray(s.log) &&
    !!s.quiz &&
    Array.isArray(s.trails)
  );
}
