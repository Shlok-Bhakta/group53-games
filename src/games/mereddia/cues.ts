import type { State } from "./engine";

// Which of the project's sound effects to play for what just happened, worked out by comparing the state
// before an action with the state after it. Pure, so it can be tested without any audio. The names are the
// project's own sound files (see public/mereddia/audio/sfx), the same ones its scripts play.

export type Cue = { name: string; delay: number; volume?: number; rate?: number };

const count = (s: State, pred: (e: State["entities"][number]) => boolean) => s.entities.filter(pred).length;
const enemies = (s: State) => count(s, (e) => e.kind === "enemy");
const panelsOpen = (s: State) => count(s, (e) => e.kind === "panel" && !!e.open);
const slabs = (s: State) => count(s, (e) => e.kind === "panel" && e.what.startsWith("slab") && !e.open);
const things = (s: State) => Object.keys(s.items).length + s.weapons.length + Number(s.shield);
const flagged = (prev: State, next: State, f: string) => !!next.flags[f] && !prev.flags[f];

// What each gesture sounds like: the lever, the button, the book, the swing of the axe.
const GESTURE: Record<string, string> = { Lever_Grab: "lever_pull", push_button: "button_press", grab_book: "Book_Open", swing_axe: "axe", pick_attack1: "pick_attack", pot_break: "hyah", touch_flame: "Sacred_Flame" };

export function cuesFor(prev: State, next: State): Cue[] {
  const cues: Cue[] = [];
  const add = (name: string, delay = 0, extra: Partial<Cue> = {}) => cues.push({ name, delay, ...extra });
  const hurt = next.hp < prev.hp;

  // Fights: your blow, the enemy's answer, and how it ends.
  const fought = prev.battle && (!next.battle || next.battle.turn !== prev.battle.turn);
  const beaten = enemies(next) < enemies(prev) && prev.area === next.area;
  if (prev.battle && fought) {
    const last = next.battle?.last.hero ?? "attack";
    if (last === "cast") add(next.element === "fire" ? "Normal_Fire" : "Magic_Crystal");
    else if (last === "dodge") add("footsteps", 0, { rate: 1.6 });
    else if (last === "attack") add(next.special === 0 && prev.special >= 7 ? "Sword_Done" : next.weapon === "axe" ? "axe" : "Sword_Attack");
    const dealt = !next.battle || next.battle.hp < prev.battle.hp;
    if (dealt && last !== "guard" && last !== "dodge") add("enemy_hit", 90);
    if (hurt) add(prev.battle.kind === "bigslime" ? "Slime_Boss_Walk" : "Slime_Walk", 140);
  }
  if (!prev.battle && next.battle) add(next.battle.kind === "bigslime" ? "Slime_Boss_Idle" : "Slime_Idle");
  if (beaten || (prev.battle && !next.battle && next.mode !== "lost" && enemies(next) < enemies(prev))) add(next.steps % 2 ? "death_enemy" : "death_enemy2", 220);
  if (hurt) add("Hit_Player", prev.battle ? 300 : 0);
  if (next.level > prev.level) add("level_up", 520);
  else if (next.hp - prev.hp >= 3) add("heal");

  // Walking.
  if (!prev.battle && !next.battle && next.area === prev.area && next.mode === "explore" && (next.pos.x !== prev.pos.x || next.pos.y !== prev.pos.y) && next.steps % 2 === 0) {
    add("footsteps", 0, { volume: 0.35, rate: next.sprinting ? 1.5 : 1 });
  }

  // The world answering: doors, slabs, plates, pots, crystals, chests.
  if (panelsOpen(next) > panelsOpen(prev)) add(next.entities.some((e) => e.what === "door" && e.open) && !prev.entities.some((e) => e.what === "door" && e.open) ? "Door_Interact" : "Stone_Wall_Open");
  if (panelsOpen(next) < panelsOpen(prev) && prev.area === next.area) add("Stone_Wall_Close");
  if (slabs(next) > slabs(prev)) add("Stone_Wall_Close", 80);
  if (count(next, (e) => e.kind === "gate") < count(prev, (e) => e.kind === "gate")) add("Open_Key");
  if (count(next, (e) => e.kind === "pot") < count(prev, (e) => e.kind === "pot")) add("clay_pottery_break", 380);
  if (count(next, (e) => e.kind === "crystal") < count(prev, (e) => e.kind === "crystal")) add("Crystal_Grab");
  if (count(next, (e) => e.kind === "chest" && !!e.done) > count(prev, (e) => e.kind === "chest" && !!e.done)) add("chest");
  if (next.quiz.step > prev.quiz.step) {
    add("pressure_plate_down");
    add("success_plate", 120);
  }
  if (next.quiz.wrong > prev.quiz.wrong) {
    add("pressure_plate_down");
    add("Poison", 150);
  }
  if (next.act && next.act.n !== prev.act?.n && GESTURE[next.act.name]) add(GESTURE[next.act.name]);

  // Things that happen once.
  if (!prev.items.pickaxe && next.items.pickaxe) add("item_pickup", 900);
  if (flagged(prev, next, "letterBurned")) add("Letter_Burn");
  if (flagged(prev, next, "pigeonPoked")) add("pigeon_flap");
  if (flagged(prev, next, "golemAwake")) {
    add("AwakenGolem");
    add("Golem_Awaken", 300);
  }
  if (flagged(prev, next, "altarUp") || flagged(prev, next, "leversDone")) add("Altar_slide");
  if (flagged(prev, next, "noteRead")) add("Note-interact");
  if (flagged(prev, next, "treeFelled")) add("chest", 200);
  if (next.items.axe && !prev.items.axe) add("axe");
  if (next.items.pickaxe && !prev.items.pickaxe) add("pickaxe_fixed");
  if (next.companion && !prev.companion) add("Ricky_Spawn");
  if (next.dlg?.node === "intro2" && prev.dlg?.node !== "intro2") add("Letter");
  if (next.dlg?.node === "tree_tele" && prev.dlg?.node !== "tree_tele") add("Magic_Crystal");

  // Pickups and rewards, if nothing louder is already happening.
  if (!cues.some((c) => ["clay_pottery_break", "Crystal_Grab", "chest", "pickaxe_fixed", "axe"].includes(c.name)) && (next.potions > prev.potions || next.keys > prev.keys || things(next) > things(prev))) add("item_pickup");
  if (Object.keys(next.quests).length > Object.keys(prev.quests).length && next.level === prev.level) add("success_plate", 200);
  return cues;
}

// Sounds that run for as long as something is going on, and how loud they should be right now.
export function loopsFor(s: State): { id: string; name: string; volume: number }[] {
  const out: { id: string; name: string; volume: number }[] = [];
  if (s.boulder) out.push({ id: "boulder", name: "Boulder_Roll", volume: 0.9 });
  if (s.area === "temple" && s.mode !== "dialogue") {
    // The waterfall pours into the lake at the north end of the river that runs down the east side of the valley.
    const toFalls = Math.hypot(s.pos.x - 33, s.pos.y - 6);
    const toRiver = Math.abs(s.pos.x - 32.5);
    out.push({ id: "waterfall", name: "Waterfall", volume: Math.max(0, 1 - toFalls / 18) * 0.7 });
    out.push({ id: "river", name: "water_noises", volume: s.pos.y > 8 ? Math.max(0, 1 - toRiver / 10) * 0.45 : 0 });
  }
  return out;
}
