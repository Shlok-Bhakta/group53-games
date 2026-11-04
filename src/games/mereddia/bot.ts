import { act, groundAt, maxHp, newGame, type Action, type Dir, type State } from "./engine";
import { NODES } from "./story";
import { ENEMIES, PLATE_ANS, SPELLS, WALKABLE, type Entity } from "./world";

// A bot that plays the whole of Arc 0 on the project's own maps: it solves the plate room, dodges the golem's
// rocks, outruns the boulder, works the temple's buttons against their timers, and fights with a sensible
// policy. If the game can be won by it, whatever the dice say, then the maps, the timers and the numbers all
// fit together.

const DIRS: Dir[] = ["up", "down", "left", "right"];
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const over = (s: State) => s.mode === "lost" || s.mode === "won";

// Things the bot walks around. Signs and quiet trigger tiles are walked over; plates and the tiles that
// start traps are only stepped on on purpose.
const blocks = (e: Entity) => !(e.kind === "pickup" || e.kind === "exit" || e.kind === "enemy" || e.kind === "plate" || (e.kind === "prop" && e.what === "sign")) && !(e.kind === "panel" && e.open);
const avoid = (e: Entity, s: State) => e.kind === "exit" || (e.kind === "plate" && (e.what.startsWith("p:") || (e.what === "t:boulder" && !s.flags.boulderStarted) || (e.what === "t:golemTrap" && !s.flags.golemAwake)));

// The first move along a shortest path to stand next to a solid thing, or on a walkable one.
export function stepToward(s: State, target: { x: number; y: number }): Dir | undefined {
  const danger = new Set(s.hazards.map((h) => `${h.x},${h.y}`));
  const here = s.entities.filter((e) => e.area === s.area);
  const bad = new Set(here.filter((e) => blocks(e) || avoid(e, s)).map((e) => `${e.x},${e.y}`));
  const open = new Set(here.filter((e) => e.kind === "panel" && e.open).map((e) => `${e.x},${e.y}`));
  // A way out that is a whole edge (the field's roads) is any cell of it: the nearest will do.
  const goal = new Set([`${target.x},${target.y}`]);
  const aimed = here.find((e) => e.x === target.x && e.y === target.y && e.kind === "exit");
  if (aimed) for (const e of here) if (e.kind === "exit" && e.what === aimed.what && e.ask === aimed.ask) goal.add(`${e.x},${e.y}`);
  const free = (x: number, y: number) => (WALKABLE.includes(groundAt(s, x, y)) || open.has(`${x},${y}`)) && !danger.has(`${x},${y}`) && !(bad.has(`${x},${y}`) && !goal.has(`${x},${y}`));
  const first = new Map<string, Dir | undefined>([[`${s.pos.x},${s.pos.y}`, undefined]]);
  const queue = [s.pos];
  while (queue.length) {
    const p = queue.shift()!;
    for (const d of DIRS) {
      const x = p.x + DELTA[d][0];
      const y = p.y + DELTA[d][1];
      const f = first.get(`${p.x},${p.y}`) ?? d;
      // Things in a wall (a button) can be pressed from beside them without being able to stand there.
      if (goal.has(`${x},${y}`)) return f;
      if (!free(x, y) || first.has(`${x},${y}`)) continue;
      first.set(`${x},${y}`, f);
      queue.push({ x, y });
    }
  }
  return undefined;
}

// Answers the enemy's telegraphed move the way a careful player would: dodge the slow heavy blow, guard against
// a flurry when hurt, hit hard when the enemy is reeling, and attack otherwise.
function battleMove(s: State): Action {
  const b = s.battle!;
  const foe = ENEMIES[b.kind];
  const max = maxHp(s.level);
  if (s.hp < max * 0.4 && s.potions > 0) return { type: "potion" };
  if (s.flags.blade && s.special >= 7) return { type: "special" };
  if (b.broken > 0) return { type: "attack" };
  if (b.intent === "heavy") return s.stamina >= 3 ? { type: "dodge" } : { type: "guard" };
  if (b.intent === "swift" && s.hp < max * 0.6) return { type: "guard" };
  const cost = SPELLS[s.element].cost;
  if (s.mana >= cost && (foe.boss || b.hp > 12)) return { type: "spell" };
  return { type: "attack" };
}

// Talk until the conversation is over, answering the first choice unless told otherwise.
export function talkThrough(s: State, picks: Record<string, number> = {}): State {
  for (let guard = 0; guard < 80 && s.mode === "dialogue"; guard++) {
    const d = s.dlg!;
    const c = NODES[d.node].choices;
    const list = typeof c === "function" ? c(s) : (c ?? []);
    s = list.length ? act(s, { type: "choose", i: picks[d.node] === -1 ? list.length - 1 : (picks[d.node] ?? 0) }) : act(s, { type: "next" });
  }
  return s;
}

// One bot "player", walking to things and settling whatever happens on the way.
class Driver {
  s: State;
  picks: Record<string, number> = {};
  low = 1;
  trace: string[] = [];
  fail?: string;
  stage = 0;
  constructor(s: State) {
    this.s = s;
  }
  get dead() {
    return over(this.s);
  }
  settle() {
    for (let guard = 0; guard < 400 && (this.s.mode === "battle" || this.s.mode === "dialogue"); guard++) {
      if (this.s.mode === "battle") this.s = act(this.s, battleMove(this.s));
      else this.s = talkThrough(this.s, this.picks);
      this.low = Math.min(this.low, this.s.hp / maxHp(this.s.level));
      if (this.dead) return;
    }
    // Heal up between fights when it's cheap.
    if (this.s.mode === "explore" && (this.s.poisoned || this.s.hp < maxHp(this.s.level) * 0.5) && this.s.potions > 0) this.s = act(this.s, { type: "potion" });
  }
  do(a: Action) {
    this.trace.push(`${a.type}${"dir" in a ? ":" + a.dir : ""}@${this.s.pos.x},${this.s.pos.y}`);
    if (this.trace.length > 2500) this.trace.shift();
    this.s = act(this.s, a);
    this.settle();
    this.low = Math.min(this.low, this.s.hp / maxHp(this.s.level));
  }
  // Walk toward an entity until `done` says we're finished.
  walk(find: (s: State) => Entity | undefined, done: (s: State) => boolean, opts: { sprint?: boolean; limit?: number } = {}) {
    this.stage++;
    for (let i = 0; i < (opts.limit ?? 600) && !this.dead; i++) {
      const before = this.s.area;
      if (done(this.s)) return true;
      const t = find(this.s);
      if (!t) return done(this.s);
      const d = stepToward(this.s, t);
      if (!d) {
        // Boxed in by a rock shadow, say: wait it out.
        this.do({ type: "wait" });
        continue;
      }
      // A pot is smashed with E: walk up to it, face it, and swing.
      if (t.kind === "pot" && Math.abs(this.s.pos.x - t.x) + Math.abs(this.s.pos.y - t.y) === 1) {
        this.do({ type: "move", dir: d });
        this.do({ type: "swing" });
        continue;
      }
      this.trace.push(`->${t.kind}:${t.what}@${t.x},${t.y}`);
      this.do({ type: "move", dir: d, sprint: opts.sprint && this.s.stamina >= 2 });
      if (this.s.area !== before) return true;
    }
    const ok = done(this.s);
    if (!ok && !this.fail) this.fail = `walk #${this.stage} failed at ${this.s.area} ${this.s.pos.x},${this.s.pos.y} target=${(() => { const t = find(this.s); return t ? `${t.kind}:${t.what}@${t.x},${t.y}` : "none"; })()} mode=${this.s.mode}`;
    return ok;
  }
  entity = (area: string, kind: string, what?: string) => (s: State) => s.entities.find((e) => e.area === area && e.kind === kind && (what === undefined || e.what === what));
}

// "direct" goes plates, boulder, temple; "full" takes the pickaxe, kills the golem, opens the key door,
// smashes some pots and touches every kind of crystal on the way.
export type Route = "direct" | "full";

export function playThrough(seed: number, route: Route = "direct", opts: { treehouse?: boolean; secrets?: boolean } = {}): State & { low?: number; trace?: string[]; fail?: string } {
  const d = new Driver(newGame(seed));
  const has = d.entity;
  const left = (a: string) => (s: State) => s.area !== a;
  d.settle(); // the pigeon's letter

  // The field: walk to the mountains.
  d.walk(has("field", "exit", "caves"), left("field"));
  if (d.dead) return d.s;

  // The caves: the plate room first. Four columns, east to west; the Secret Master's hint is the answer.
  for (let col = 0; col < 4 && !d.dead; col++) d.walk(has("caves", "plate", `p:${col}:${PLATE_ANS[col]}`), (s) => s.quiz.step > col);
  if (d.dead) return d.s;

  if (route === "full") {
    d.walk(has("caves", "prop", "pickrock"), (s) => !!s.items.pickaxe);
    // Into the golem's hollow: step on the trap, then cross under the rocks.
    d.walk(has("caves", "plate", "t:golemTrap"), (s) => !!s.flags.golemAwake);
    d.walk(has("caves", "enemy", "golem"), (s) => !!s.flags.golemDown, { limit: 400 });
    d.walk(has("caves", "gate"), (s) => s.mode === "dialogue" || !s.entities.some((e) => e.kind === "gate"));
    if (d.s.mode === "dialogue" && d.s.dlg?.node === "gate_open") d.do({ type: "choose", i: 0 });
    for (let k = 0; k < 4 && !d.dead; k++) {
      const n = d.s.entities.filter((e) => e.kind === "pot").length;
      d.walk(has("caves", "pot"), (s) => s.entities.filter((e) => e.kind === "pot").length < n);
    }
    for (const el of ["fire", "water", "air", "earth", "universal"]) d.walk((s) => s.entities.find((e) => e.area === "caves" && e.kind === "crystal" && e.what === el), (s) => !!s.flags[`crystal_${el}`]);
  }
  if (d.dead) return d.s;

  // The long hall: step on the trigger and run for the exit.
  d.walk(has("caves", "plate", "t:boulder"), (s) => !!s.flags.boulderStarted);
  d.walk(has("caves", "exit", "temple"), left("caves"), { sprint: true });
  if (d.dead) return d.s;

  // The valley: the secret wall button and the Secret Master, the note behind the falls, Drawf.
  if (opts.secrets !== false) {
    d.walk(has("temple", "button", "mountain"), (s) => !!s.flags.secretOpen);
    d.walk(has("temple", "npc", "master"), (s) => !!s.companion);
    d.walk(has("temple", "prop", "table"), (s) => !!s.flags.noteRead);
  }
  d.walk(has("temple", "npc", "drawf"), (s) => !!s.flags.drawfJoins);
  // The temple door, then the hall: blue button, gold button, red button, and quick about it.
  d.walk(has("temple", "panel", "door"), (s) => !!s.entities.find((e) => e.what === "door" && e.open));
  d.walk(has("temple", "button", "L1"), (s) => !!s.entities.find((e) => e.what === "w1" && e.open));
  d.walk(has("temple", "button", "gold"), (s) => !!s.flags.armed);
  d.walk(has("temple", "button", "R1"), (s) => !!s.flags.puzzleDone, { sprint: true });
  // Through the sanctum door before it shuts, to Vastios.
  d.walk(has("temple", "npc", "vastios"), (s) => !!s.flags.vastiosGone, { sprint: true });
  if (d.dead) return d.s;

  // The sanctum: take the secret, then the way out.
  d.walk(has("temple", "lever", "raise"), (s) => !!s.flags.altarUp);
  d.walk(has("temple", "chest", "altar"), (s) => !!s.shield);
  d.walk(has("temple", "lever", "lower"), (s) => !!s.flags.leversDone);
  if (opts.secrets !== false) for (let k = 0; k < 8; k++) d.walk(has("temple", "prop", `shelf:${k}`), (s) => !!s.flags[`lore${k}`]);
  // Outside, Vastios sends Mallakoth to the Slime Fields.
  d.walk(has("temple", "npc", "vastios"), (s) => s.area !== "temple");
  if (d.dead) return d.s;

  if (opts.treehouse) {
    d.walk(has("slimes", "exit"), left("slimes"));
    d.picks.tree_menu = -1;
    d.walk(has("treehouse", "npc", "master"), (s) => !!s.flags.treehouseMet);
    d.walk(has("treehouse", "exit"), left("treehouse"));
  }

  // The statue, then every slime, then the Great Slime.
  d.walk(has("slimes", "prop", "statue"), (s) => !!s.flags.blade);
  const slime = (s: State) => s.entities.filter((e) => e.area === "slimes" && e.kind === "enemy").sort((a, b) => Math.abs(a.x - s.pos.x) + Math.abs(a.y - s.pos.y) - (Math.abs(b.x - s.pos.x) + Math.abs(b.y - s.pos.y)))[0];
  d.walk(slime, (s) => s.mode === "won" || (!!s.flags.bigSpawned && !s.entities.some((e) => e.kind === "enemy" && e.area === "slimes")), { limit: 3000 });
  d.settle();
  return Object.assign(d.s, { low: d.low, trace: d.trace, fail: d.fail });
}
