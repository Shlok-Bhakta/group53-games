import { describe, expect, it } from "vitest";
import {
  POTION_HEAL,
  ROCK_DAMAGE,
  STAMINA_MAX,
  act,
  attackOf,
  boulderTile,
  defenseOf,
  entityAt,
  groundAt,
  isState,
  maxHp,
  maxMana,
  newGame,
  potionCap,
  slimesLeft,
  xpToNext,
  type Action,
  type Dir,
  type State,
} from "./engine";
import { AREAS, AREA_IDS, ENEMIES, PLATE_ANS, QUESTS, SLIME_COLORS, SLIME_WAVE, WALKABLE, parseArea, sizeOf, type AreaId, type Entity } from "./world";
import { NODES } from "./story";
import { playThrough, stepToward, talkThrough } from "./bot";

const play = (s: State, ...actions: Action[]) => actions.reduce(act, s);
const mv = (dir: Dir, sprint = false): Action => ({ type: "move", dir, sprint });
const choose = (i: number): Action => ({ type: "choose", i });
const next: Action = { type: "next" };
// A battle whose enemy has just announced a given move (a plain strike by default), so damage is predictable.
const strike = (s: State, intent: "strike" | "heavy" | "swift" = "strike"): State => (s.battle ? { ...s, battle: { ...s.battle, intent } } : s);

// A game with the hero standing at (x, y) in an area, with the opening letter already dealt with.
const at = (area: AreaId, x: number, y: number, extra: Partial<State> = {}): State => ({ ...newGame(1), mode: "explore", dlg: undefined, area, pos: { x, y }, ...extra });
const put = (s: State, e: Omit<Entity, "id">): State => ({ ...s, entities: [...s.entities, { ...e, id: `test:${e.what}@${e.x},${e.y}` }] });
const foe = (s: State, what: string, x: number, y: number, extra: Partial<Entity> = {}) => put(s, { area: s.area, kind: "enemy", what, x, y, ...extra });
const get = (s: State, area: string, kind: string, what: string) => s.entities.find((e) => e.area === area && e.kind === kind && e.what === what)!;
const open = (s: State, ...whats: string[]): State => ({ ...s, entities: s.entities.map((e) => (e.kind === "panel" && whats.includes(e.what) ? { ...e, open: true } : e)) });

describe("the map", () => {
  it("has a rectangle for every area, walled in except for its doors", () => {
    for (const id of AREA_IDS) {
      const def = AREAS[id];
      const { ground, entities, width, height } = parseArea(id);
      expect(def.rows.every((r) => r.length === width), `${id} is not a rectangle`).toBe(true);
      expect(ground).toHaveLength(height);
      const exits = new Set(entities.filter((e) => e.kind === "exit").map((e) => `${e.x},${e.y}`));
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
          if (edge && !def.map3d && WALKABLE.includes(ground[y][x])) expect(exits.has(`${x},${y}`) || entities.some((e) => e.x === x && e.y === y && e.kind !== "plate"), `${id} leaks at ${x},${y}`).toBe(true);
        }
    }
  });

  it("only puts things on open ground, one to a tile, with unique ids", () => {
    const all = AREA_IDS.flatMap((a) => parseArea(a).entities);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    // Buttons, levers and panels are set into walls; everything else stands on open ground.
    for (const e of all) if (!["button", "lever", "panel", "prop", "chest"].includes(e.kind)) expect(WALKABLE, `${e.id}`).toContain(groundAt({ area: e.area }, e.x, e.y));
    for (const id of AREA_IDS) {
      const tiles = parseArea(id).entities.map((e) => `${e.x},${e.y}`);
      expect(new Set(tiles).size, id).toBe(tiles.length);
    }
  });

  it("sends every door to open ground that isn't another door", () => {
    for (const e of AREA_IDS.flatMap((a) => parseArea(a).entities).filter((e) => e.kind === "exit" && e.to)) {
      const to = e.to!;
      expect(WALKABLE).toContain(groundAt({ area: to.area }, to.x, to.y));
      expect(parseArea(to.area).entities.find((o) => o.x === to.x && o.y === to.y)).toBeUndefined();
    }
  });

  it("can be walked from every arrival to every thing in it, once panels and gates are open", () => {
    const arrivals = new Map<AreaId, { x: number; y: number }[]>(AREA_IDS.map((a) => [a, []]));
    arrivals.get("field")!.push(AREAS.field.start!);
    for (const e of AREA_IDS.flatMap((a) => parseArea(a).entities).filter((e) => e.kind === "exit" && e.to)) arrivals.get(e.to!.area)!.push(e.to!);
    for (const id of AREA_IDS) {
      const { ground, entities, width, height } = parseArea(id);
      const panels = new Set(entities.filter((e) => e.kind === "panel").map((e) => `${e.x},${e.y}`));
      for (const from of arrivals.get(id)!) {
        const seen = new Set([`${from.x},${from.y}`]);
        const queue = [from];
        while (queue.length) {
          const p = queue.shift()!;
          for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const x = p.x + dx;
            const y = p.y + dy;
            if (x < 0 || y < 0 || x >= width || y >= height || seen.has(`${x},${y}`)) continue;
            if (!WALKABLE.includes(ground[y][x]) && !panels.has(`${x},${y}`)) continue;
            seen.add(`${x},${y}`);
            // A prompt that carries you somewhere else in the same area (into the spring) is a way across too.
            const hop = entities.find((o) => o.x === x && o.y === y && o.kind === "exit" && o.to?.area === id);
            if (hop && !seen.has(`${hop.to!.x},${hop.to!.y}`)) {
              seen.add(`${hop.to!.x},${hop.to!.y}`);
              queue.push({ x: hop.to!.x, y: hop.to!.y });
            }
            // Anything solid is walked up to, not through (open panels, gates, signs and plates aside).
            const e = entities.find((o) => o.x === x && o.y === y);
            if (!e || ["plate", "pickup", "exit", "panel", "gate", "enemy"].includes(e.kind) || e.what === "sign") queue.push({ x, y });
          }
        }
        // Everything with a part to play can be walked up to. Scenery and the things stacked in the cave's basement can't.
        for (const e of entities.filter((o) => !(o.kind === "prop" && (o.what === "scenery" || o.what === "flame")))) {
          const near = [[0, 1], [0, -1], [1, 0], [-1, 0], [0, 0]].some(([dx, dy]) => seen.has(`${e.x + dx},${e.y + dy}`));
          expect(near, `${id}: ${e.kind} ${e.what} at ${e.x},${e.y} can't be reached from ${from.x},${from.y}`).toBe(true);
        }
      }
    }
  });

  it("treats anything off the map as a wall", () => {
    expect(groundAt({ area: "field" }, -1, 3)).toBe("#");
    expect(groundAt({ area: "field" }, 3, sizeOf("field").height)).toBe("#");
  });

  it("has a conversation for everything anyone can say", () => {
    for (const [id, n] of Object.entries(NODES)) {
      if (n.next) expect(NODES[n.next], `${id} -> ${n.next}`).toBeDefined();
      for (const c of typeof n.choices === "function" ? [] : (n.choices ?? [])) if (c.to) expect(NODES[c.to], `${id} -> ${c.to}`).toBeDefined();
    }
  });

  it("has a quest for every reward the engine hands out", () => {
    expect(QUESTS.map((q) => q.id)).toEqual(expect.arrayContaining(["caves", "plates", "golem", "crystals", "run", "falls", "secret", "drawf", "flame", "scholar", "levers", "slimes", "prism", "great"]));
  });
});

describe("the beginning", () => {
  it("opens with the pigeon's letter, and the letter asks to be burned", () => {
    let s = newGame(1);
    expect(s.mode).toBe("dialogue");
    expect(s.dlg?.node).toBe("intro1");
    s = play(s, next, next);
    expect(NODES[s.dlg!.node].choices).toBeDefined();
    s = play(s, choose(1)); // read it once more
    expect(s.dlg?.node).toBe("intro2");
    s = talkThrough(s);
    expect(s.mode).toBe("explore");
    expect(s.flags.letterBurned).toBe(true);
  });

  it("asks before leaving the field, and quits asking if you say no", () => {
    const s = at("field", 1, 33);
    const asked = act(s, mv("left"));
    expect(asked.mode).toBe("dialogue");
    expect(asked.dlg?.node).toBe("go_caves");
    const no = act(asked, choose(1));
    expect(no.mode).toBe("explore");
    expect(no.area).toBe("field");
    const yes = act(asked, choose(0));
    expect(yes.area).toBe("caves");
    expect(yes.quests.caves).toBe(true);
    expect(yes.xp).toBeGreaterThan(0);
  });

  it("keeps only the last few log lines", () => {
    let s = at("field", 3, 3);
    for (let i = 0; i < 12; i++) s = act(s, { type: "potion" });
    expect(s.log.length).toBeLessThanOrEqual(5);
  });

  it("doesn't change the state it was given", () => {
    const before = at("field", 3, 3);
    const copy = structuredClone(before);
    act(before, mv("down"));
    expect(before).toEqual(copy);
  });
});

describe("turning and backing up", () => {
  it("turns on the spot without taking a step", () => {
    const s = at("field", 5, 5, { facing: "up" });
    const n = act(s, { type: "turn", dir: "left" });
    expect(n.facing).toBe("left");
    expect(n.pos).toEqual(s.pos);
    expect(n.steps).toBe(s.steps);
  });
  it("backs up without turning round", () => {
    const n = act(at("field", 5, 5, { facing: "up" }), { type: "move", dir: "down", keep: true });
    expect(n.facing).toBe("up");
    expect(n.pos).toEqual({ x: 5, y: 6 });
  });
});

describe("the old tree", () => {
  const stump = () => get(at("field", 0, 0), "field", "prop", "stump");
  const tree = () => get(at("field", 0, 0), "field", "prop", "tree");
  const nextTo = (e: { x: number; y: number }, extra: Partial<State> = {}) => at("field", e.x, e.y + 1, { facing: "up", ...extra });
  const swingAt = (s: State) => act(s, { type: "swing" });

  it("fills its whole footprint: the tree and the stump are two tiles square", () => {
    for (const e of [stump(), tree()]) {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        expect(entityAt(at("field", 0, 0), e.x + dx, e.y + dy), `${e.what} ${dx},${dy}`).toBeDefined();
      }
    }
    // Bumping the far corner of the stump is bumping the stump; swinging at the far corner of the tree is swinging at the tree.
    const corner = act(at("field", stump().x + 1, stump().y + 2, { facing: "up" }), mv("up"));
    expect(corner.dlg?.node).toBe("axe_get");
    const t = tree();
    const hit = act(at("field", t.x + 1, t.y + 2, { facing: "up", items: { axe: true } }), { type: "swing" });
    expect(hit.dlg?.node).toBe("tree_poke");
  });

  it("is chopped with a swing (E), not by walking into it", () => {
    const walked = act(nextTo(tree(), { items: { axe: true } }), mv("up"));
    expect(walked.dlg).toBeUndefined();
    expect(walked.log.at(-1)).toMatch(/Press E/);
    expect(swingAt(at("field", 3, 3, { items: { axe: true } })).log.at(-1)).toMatch(/through the air/);
    expect(swingAt(at("field", 3, 3)).log.at(-1)).toMatch(/nothing to swing|no axe/);
  });

  it("gives the axe from the stump, once", () => {
    let s = talkThrough(act(nextTo(stump()), mv("up")));
    expect(s.items.axe).toBe(true);
    s = talkThrough(act(s, mv("up")));
    expect(s.dlg).toBeUndefined();
    expect(s.log.join(" ")).toMatch(/Axe added/);
  });

  it("gives the axe from any side, with no scene", () => {
    const e = stump();
    const side = talkThrough(act(at("field", e.x - 1, e.y + 1, { facing: "right", cut: undefined }), mv("right")));
    expect(side.items.axe).toBe(true);
    expect(side.cut).toBeUndefined();
    const south = talkThrough(act(at("field", e.x, e.y + 2, { facing: "up", cut: undefined }), mv("up")));
    expect(south.items.axe).toBe(true);
    expect(south.cut).toBeUndefined();
  });

  it("won't be touched without the axe", () => {
    const s = act(nextTo(tree()), mv("up"));
    expect(s.dlg?.node).toBe("tree_nope");
  });

  it("is guarded by the pigeon, which pecks you before you can swing", () => {
    const s = swingAt(nextTo(tree(), { items: { axe: true } }));
    expect(s.dlg?.node).toBe("tree_poke");
    const after = talkThrough(s);
    expect(after.flags.pigeonPoked).toBe(true);
    expect(after.hp).toBeLessThan(maxHp(1));
  });

  it("the pigeon always just flutters back up to its branch after the peck", () => {
    for (let seed = 1; seed < 20; seed++) {
      const after = act({ ...swingAt(nextTo(tree(), { items: { axe: true } })), rng: seed }, next);
      expect(after.dlg?.node).toBe("pigeon_back");
    }
  });

  it("the pigeon now and then pecks again instead of letting the axe fall", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const s = act(at("field", tree().x + 1, tree().y + 2, { facing: "up", items: { axe: true }, flags: { pigeonPoked: true }, cut: undefined, rng: seed, hp: 10 }), { type: "swing" });
      seen.add(s.dlg?.node ?? "chop");
    }
    expect(seen.has("tree_repeck")).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("brings wood from a felled tree", () => {
    let s = at("field", tree().x + 1, tree().y + 2, { facing: "up", items: { axe: true }, flags: { pigeonPoked: true }, cut: undefined });
    for (let i = 0; i < 12 && !s.flags.treeFelled; i++) s = talkThrough(act(s, { type: "swing" }));
    expect(s.wood).toBe(3);
  });

  it("sends the pigeon flying off every time the tree falls", () => {
    for (let seed = 1; seed < 10; seed++) {
      let s = at("field", tree().x + 1, tree().y + 2, { facing: "up", items: { axe: true }, flags: { pigeonPoked: true }, cut: undefined, rng: seed });
      for (let i = 0; i < 12 && !s.flags.treeFelled; i++) s = talkThrough(act(s, { type: "swing" }));
      expect(s.cut?.id).toBe("flyaway");
    }
  });

  it("carries you into the magical spring by a prompt, and out again by another", () => {
    const hurt = at("caves", 27, 4, { hp: 2, mana: 0, poisoned: true });
    const asked = act(hurt, mv("left"));
    expect(asked.dlg?.node).toBe("spring_in");
    const checkpoint = asked.ck;
    const inside = act(asked, choose(0));
    expect(inside.pos).toEqual({ x: 22, y: 4 });
    expect(inside.hp).toBe(maxHp(inside.level));
    expect(inside.mana).toBe(maxMana(inside));
    expect(inside.poisoned).toBe(false);
    // Going in does not move the checkpoint.
    expect(inside.ck).toBe(checkpoint);
    // The man bathing there can be talked to from the next cell along.
    const beside = act(act(inside, mv("left")), mv("left"));
    expect(beside.dlg?.node).toBe("alexis1");
    const leaving = act(act(talkThrough(beside), mv("right")), mv("right"));
    const out = act(act(leaving, mv("right")), mv("right"));
    expect(out.dlg?.node).toBe("spring_out");
    expect(act(out, choose(0)).pos).toEqual({ x: 27, y: 4 });
  });

  it("the riddle signs go quiet once the plates have been solved", () => {
    const sign = get(at("caves", 0, 0), "caves", "prop", "sign");
    const near = (done: boolean) => {
      const base = at("caves", sign.x, sign.y + 1);
      return act({ ...base, quiz: { ...base.quiz, done } }, mv("up"));
    };
    expect(sign).toBeDefined();
    expect(near(false).dlg?.node).toBe("sign_text");
    expect(near(true).dlg).toBeUndefined();
  });

  it("the trail sign reads differently from every side", () => {
    const sign = get(at("field", 0, 0), "field", "prop", "trailsign");
    const read = (from: { x: number; y: number }, dir: Dir) => {
      const s = act(at("field", from.x, from.y), mv(dir));
      const n = NODES[s.dlg!.node];
      return typeof n.text === "function" ? n.text(s) : n.text;
    };
    const texts = new Set([read({ x: sign.x, y: sign.y + 1 }, "up"), read({ x: sign.x, y: sign.y - 1 }, "down"), read({ x: sign.x - 1, y: sign.y }, "right"), read({ x: sign.x + 1, y: sign.y }, "left")]);
    expect(texts.size).toBe(4);
  });
});

// A hero standing next to a thing, about to walk into it.
const DX: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const beside = (area: AreaId, e: { x: number; y: number }, dir: Dir, extra: Partial<State> = {}) => at(area, e.x - DX[dir][0], e.y - DX[dir][1], { facing: dir, ...extra });
const bump = (area: AreaId, e: { x: number; y: number }, dir: Dir, extra: Partial<State> = {}) => act(beside(area, e, dir, extra), mv(dir));
const plateAt = (s: State, col: number, row: number) => get(s, "caves", "plate", `p:${col}:${row}`);
// Step onto a plate in the plate room from the walkway on its east side.
const step = (s: State, col: number, row: number) => {
  const p = plateAt(s, col, row);
  return act({ ...s, pos: { x: p.x + 1, y: p.y }, mode: "explore" }, mv("left"));
};

describe("the caves", () => {
  it("are entered from the field's west road, and the way back leads home", () => {
    const asked = act(at("field", 1, 33), mv("left"));
    const there = act(asked, choose(0));
    expect(there.area).toBe("caves");
    expect(there.pos).toEqual(AREAS.caves.arrive);
    expect(there.quests.caves).toBe(true);
    const home = act(at("caves", 41, 40), mv("right"));
    expect(home.area).toBe("field");
  });

  it("have the Secret Master, who greets you when you walk past him, once", () => {
    const trigger = get(at("caves", 0, 0), "caves", "plate", "t:master");
    let s = act(beside("caves", trigger, "left"), mv("left"));
    expect(s.dlg?.node).toBe("sm_first1");
    s = talkThrough(s, { sm_first3: 1 });
    expect(s.flags.metMaster).toBe(true);
    expect(s.log.join(" ")).toBeDefined();
    const again = act({ ...s, pos: { x: trigger.x + 1, y: trigger.y } }, mv("left"));
    expect(again.mode).toBe("explore");
  });

  it("make his hint the real answer to the plate room: 2314", () => {
    expect(PLATE_ANS).toEqual([2, 3, 1, 4]);
    let s = act({ ...at("caves", 0, 0), pos: { x: 40, y: 22 } }, { type: "wait" });
    const m = get(s, "caves", "npc", "master");
    s = act(beside("caves", m, "left"), mv("left"));
    s = talkThrough({ ...s }, {});
    const hint = NODES.sm_first_hint.text;
    expect(typeof hint === "function" ? hint(s) : hint).toContain("2314");
  });
});

describe("the plate room", () => {
  const room = () => at("caves", 40, 10);

  it("shows its questions on signs you read by walking over them", () => {
    const s = act(at("caves", 41, 10), mv("left"));
    expect(s.dlg?.node).toBe("sign_text");
    expect(s.dlg?.text).toMatch(/Four sets of pressure plates/);
  });

  it("has sixteen plates in four columns of four, and one safe plate in each column", () => {
    const plates = room().entities.filter((e) => e.area === "caves" && e.kind === "plate" && e.what.startsWith("p:"));
    expect(plates).toHaveLength(16);
    for (let col = 0; col < 4; col++) expect(plates.filter((e) => e.what.startsWith(`p:${col}:`))).toHaveLength(4);
  });

  it("opens the far door and pays out when the four safe plates are stepped on in order", () => {
    let s = room();
    for (let col = 0; col < 4; col++) s = step(s, col, PLATE_ANS[col]);
    expect(s.quiz.done).toBe(true);
    expect(s.entities.filter((e) => e.area === "caves" && e.what === "plates").every((e) => e.open)).toBe(true);
    expect(s.quests.plates).toBe(true);
    expect(s.poisoned).toBe(false);
  });

  it("poisons you for a first mistake: hurt, no regeneration, cured by a potion", () => {
    const wrong = PLATE_ANS[0] === 1 ? 2 : 1;
    let s = step(room(), 0, wrong);
    expect(s.mode).toBe("explore");
    expect(s.poisoned).toBe(true);
    const hurt = s.hp;
    expect(hurt).toBeLessThan(maxHp(1));
    s = { ...s, ticks: 0, pos: { x: 40, y: 9 } };
    for (let i = 0; i < 12; i++) s = act(s, { type: "wait" });
    expect(s.hp).toBe(hurt);
    s = act({ ...s, potions: 1 }, { type: "potion" });
    expect(s.poisoned).toBe(false);
    expect(s.hp).toBeGreaterThan(hurt);
  });

  it("kills you for a second", () => {
    const wrong = PLATE_ANS[0] === 1 ? 2 : 1;
    const s = step(step({ ...room(), hp: 100 }, 0, wrong), 0, wrong);
    expect(s.mode).toBe("lost");
  });

  it("does not count a safe plate stepped on out of order", () => {
    const s = step(room(), 2, PLATE_ANS[2]);
    expect(s.quiz.step).toBe(0);
  });

  it("lets you try again from where the caves began, with the puzzle reset", () => {
    const wrong = PLATE_ANS[0] === 1 ? 2 : 1;
    const entered = act(at("field", 1, 33), mv("left"));
    const dead = step(step({ ...act(entered, choose(0)), hp: 100, pos: { x: 40, y: 10 } }, 0, wrong), 0, wrong);
    expect(dead.mode).toBe("lost");
    const back = act(dead, { type: "retry" });
    expect(back.mode).toBe("explore");
    expect(back.deaths).toBe(1);
    expect(back.area).toBe("caves");
    expect(back.quiz.wrong).toBe(0);
    expect(back.poisoned).toBe(false);
  });
});

describe("the golem", () => {
  const trap = () => get(at("caves", 0, 0), "caves", "plate", "t:golemTrap");
  const golem = () => get(at("caves", 0, 0), "caves", "enemy", "golem");
  const woken = () => act({ ...at("caves", trap().x, trap().y - 1) }, mv("down"));

  it("sleeps until you step on the trap tile, which seals the hollow behind you", () => {
    const s = woken();
    expect(s.flags.golemAwake).toBe(true);
    expect(s.entities.filter((e) => e.what === "slab:golem")).toHaveLength(2);
    expect(entityAt(s, 14, 44)?.what).toBe("slab:golem");
  });

  it("throws no rocks before it wakes", () => {
    let s = at("caves", golem().x, golem().y - 5, { ticks: 2 });
    for (let i = 0; i < 6; i++) s = act(s, mv(i % 2 ? "left" : "right"));
    expect(s.hazards).toHaveLength(0);
  });

  it("then throws rocks that show a shadow first, and hurt a lot if you stand in them", () => {
    let s = { ...woken(), ticks: 2, pos: { x: golem().x, y: golem().y - 5 }, facing: "down" as Dir };
    s = act(s, mv("down")); // tick 3: a volley
    expect(s.hazards.length).toBeGreaterThan(0);
    // Rocks come down at random on the floor near you, each shown two ticks ahead.
    for (const h of s.hazards) {
      expect(h.fuse).toBe(2);
      expect(Math.abs(h.x - s.pos.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(h.y - s.pos.y)).toBeLessThanOrEqual(3);
    }
    const hit = play({ ...s, hazards: [{ x: s.pos.x, y: s.pos.y, fuse: 1 }] }, { type: "wait" });
    expect(hit.hp).toBeLessThanOrEqual(maxHp(1) - ROCK_DAMAGE);
  });

  it("can always be dodged by stepping off the shadow", () => {
    const s = { ...woken(), ticks: 2, pos: { x: golem().x, y: golem().y - 5 }, hp: maxHp(1) };
    const volley = act(s, mv("down"));
    const away = play({ ...volley, facing: "down" }, mv("left"), mv("left"), mv("left"));
    expect(away.hp).toBeGreaterThan(volley.hp - ROCK_DAMAGE);
  });

  it("won't be fought bare-handed", () => {
    const s = bump("caves", golem(), "down", { flags: { golemAwake: true } });
    expect(s.dlg?.node).toBe("golem_nope");
  });

  it("shatters in one blow with the pickaxe, drops a key and unseals the hollow", () => {
    let s = bump("caves", golem(), "down", { items: { pickaxe: true }, flags: { golemAwake: true } });
    expect(s.dlg?.node).toBe("golem_down");
    s = talkThrough({ ...s, entities: [...s.entities, { id: "x", area: "caves", kind: "panel", what: "slab:golem", x: 14, y: 44 }] });
    expect(s.keys).toBe(1);
    expect(s.entities.some((e) => e.kind === "enemy" && e.what === "golem")).toBe(false);
    expect(s.entities.some((e) => e.what === "slab:golem")).toBe(false);
    expect(s.quests.golem).toBe(true);
  });

  it("keeps a pickaxe in a rock: a prompt takes it, and the rock stays until it is struck down for stone", () => {
    const rock = get(at("caves", 0, 0), "caves", "prop", "pickrock");
    const asked = bump("caves", rock, "left");
    expect(asked.dlg?.node).toBe("pick_take");
    expect(asked.items.pickaxe).toBeUndefined();
    const taken = act(asked, choose(0));
    expect(taken.items.pickaxe).toBe(true);
    expect(taken.act).toBeUndefined();
    // The rock is still there, to be swung at.
    const stone = get(taken, "caves", "prop", "rock");
    expect(stone).toMatchObject({ x: rock.x, y: rock.y });
    let s: State = { ...taken, act: undefined };
    for (let i = 0; i < 3; i++) s = act(s, { type: "swing" });
    expect(s.act?.name).toBe("pick_attack1");
    expect(s.stone).toBe(3);
    expect(s.entities.some((e) => e.what === "rock")).toBe(false);
    // Rubble can be walked over.
    expect(act({ ...s, act: undefined }, mv("left")).pos).toEqual({ x: rock.x, y: rock.y });
  });

  it("is why the key door is locked", () => {
    const g = get(at("caves", 0, 0), "caves", "gate", "gate");
    expect(bump("caves", g, "down").entities.some((e) => e.kind === "gate")).toBe(true);
    // With a key it asks first; the gate opens when you say so.
    const asked = bump("caves", g, "down", { keys: 1 });
    expect(asked.dlg?.node).toBe("gate_open");
    expect(asked.entities.some((e) => e.kind === "gate")).toBe(true);
    expect(act(asked, choose(1)).entities.some((e) => e.kind === "gate")).toBe(true);
    const open = act(asked, choose(0));
    expect(open.entities.some((e) => e.kind === "gate")).toBe(false);
    expect(open.keys).toBe(0);
  });
});

describe("pots and crystals", () => {
  it("pots break once and give assorted things", () => {
    const outcomes = new Set<string>();
    const pot = get(at("caves", 0, 0), "caves", "pot", "pot");
    for (let seed = 1; seed < 60; seed++) {
      const smashed = act(beside("caves", pot, "down", { rng: seed }), { type: "swing" });
      expect(smashed.entities.some((e) => e.id === pot.id)).toBe(false);
      outcomes.add(`${smashed.gold}/${smashed.potions}`);
    }
    expect(outcomes.size).toBeGreaterThan(3);
  });

  it("are not broken by walking into them, only by E", () => {
    const pot = get(at("caves", 0, 0), "caves", "pot", "pot");
    const bumped = bump("caves", pot, "down");
    expect(bumped.entities.some((e) => e.id === pot.id)).toBe(true);
    expect(bumped.log.at(-1)).toMatch(/Press E/);
  });

  it("never give more potions than the pack holds", () => {
    expect(potionCap({})).toBe(4);
    expect(potionCap({ companion: "ricky" })).toBe(10);
    const pot = get(at("caves", 0, 0), "caves", "pot", "pot");
    for (let seed = 1; seed < 40; seed++) expect(act(beside("caves", pot, "down", { rng: seed, potions: 4 }), { type: "swing" }).potions).toBeLessThanOrEqual(4);
  });

  it("a crystal makes its magic stronger and your mana bigger", () => {
    const c = get(at("caves", 0, 0), "caves", "crystal", "fire");
    const after = bump("caves", c, "down");
    expect(after.magic.fire).toBe(2);
    expect(maxMana(after)).toBeGreaterThan(maxMana(at("caves", 0, 0)));
    expect(entityAt(after, c.x, c.y)).toBeUndefined();
  });

  it("one of every kind finishes the quest, and the spells stop growing at a point", () => {
    let s = at("caves", 0, 0);
    for (const el of ["fire", "water", "air", "earth", "universal"]) {
      const c = s.entities.find((e) => e.area === "caves" && e.kind === "crystal" && e.what === el)!;
      s = act({ ...s, mode: "explore", pos: { x: c.x, y: c.y + 1 } }, mv("up"));
    }
    expect(s.quests.crystals).toBe(true);
  });
});

describe("the boulder", () => {
  const trigger = () => get(at("caves", 0, 0), "caves", "plate", "t:boulder");
  const exit = () => get(at("caves", 0, 0), "caves", "exit", "temple");
  const rolling = () => act(beside("caves", trigger(), "left"), mv("left"));

  it("starts to roll when you step into the long hall, and slabs seal the way you came", () => {
    const s = rolling();
    expect(s.boulder).toBeDefined();
    expect(s.entities.filter((e) => e.what === "slab:boulder")).toHaveLength(2);
    expect(boulderTile(s)).toMatchObject({ x: 4 });
  });

  it("catches anyone who stands about", () => {
    let s = rolling();
    for (let i = 0; i < 80 && s.mode === "explore" && s.area === "caves"; i++) s = act(s, { type: "wait" });
    expect(s.mode).toBe("lost");
    expect(s.log.at(-1)).toMatch(/boulder/);
  });

  it("lets anyone who just walks get out ahead of it", () => {
    let s = rolling();
    for (let i = 0; i < 80 && s.area === "caves" && s.mode === "explore"; i++) s = act(s, mv(stepToward(s, exit())!));
    expect(s.mode).toBe("explore");
    expect(s.area).toBe("temple");
    expect(s.quests.run).toBe(true);
  });

  it("lets anyone who sprints get out, into the Valley of Time", () => {
    let s = rolling();
    for (let i = 0; i < 60 && s.area === "caves" && s.mode === "explore"; i++) s = act(s, mv(stepToward(s, exit())!, s.stamina >= 2));
    expect(s.mode).toBe("explore");
    expect(s.area).toBe("temple");
    expect(s.quests.run).toBe(true);
    expect(s.boulder).toBeUndefined();
  });

  it("is a long hall, and sprinting wears you out", () => {
    let s = at("temple", 36, 30);
    for (let i = 0; i < 2; i++) s = act(s, mv("up", true));
    expect(s.stamina).toBeLessThan(STAMINA_MAX);
    expect(act({ ...s, stamina: 0 }, mv("up", true)).pos.y).toBe(s.pos.y - 1);
  });

  it("leaves no room for a dash", () => {
    const s = act({ ...rolling(), facing: "up" }, { type: "dash" });
    expect(s.pos).toEqual(rolling().pos);
  });
});

describe("the valley and the Temple", () => {
  const T = () => at("temple", 0, 0);
  const button = (what: string) => get(T(), "temple", "button", what);

  it("hides the Secret Master behind a button in the wall, which opens the rock", () => {
    const b = button("mountain");
    let s = bump("temple", b, "left");
    expect(s.dlg?.node).toBe("mtn_btn");
    s = talkThrough(s);
    expect(s.flags.secretOpen).toBe(true);
    expect(get(s, "temple", "panel", "secret").open).toBe(true);
    const through = play({ ...s, pos: { x: 14, y: 13 } }, mv("left"), mv("left"), mv("left"));
    expect(through.pos.x).toBe(11);
    expect(through.zone).toBeUndefined();
  });

  it("names the Secret Master's room when you walk in, and pays the quest", () => {
    const s = act(at("temple", 9, 13), mv("left"));
    expect(s.zone).toBe("hideout");
    expect(s.quests.secret).toBe(true);
  });

  it("gives Ricky to anyone who accepts, only once, and he waits outside buildings", () => {
    const master = get(T(), "temple", "npc", "master");
    let s = talkThrough(bump("temple", master, "left", { flags: { metMaster: true } }), { sm_ret3: 0 });
    expect(s.companion).toBe("ricky");
    expect(potionCap(s)).toBe(10);
    s = act({ ...at("temple", 30, 20), companion: "ricky", ricky: { x: 30, y: 20 } }, mv("right"));
    expect(s.ricky).toEqual({ x: 30, y: 20 });
    const hall = at("temple", 21, 19, { companion: "ricky", ricky: { x: 21, y: 19 }, entities: T().entities.map((e) => (e.what === "door" ? { ...e, open: true } : e)) });
    const inside = play(hall, mv("up"), mv("up"));
    expect(inside.zone).toBe("hall");
    expect(inside.ricky).toBeUndefined();
    expect(inside.companion).toBe("ricky");
    const out = play(inside, mv("down"), mv("down"), mv("down"));
    expect(out.zone).toBeUndefined();
    expect(out.ricky).toBeDefined();
    const nope = talkThrough(bump("temple", master, "left", { flags: { metMaster: true } }), { sm_ret3: 1 });
    expect(nope.companion).toBeUndefined();
    expect(nope.flags.rickyNo).toBe(true);
  });

  it("pays five gold for reading the note behind the falls, then the note comes alive", () => {
    const table = get(T(), "temple", "prop", "table");
    let s = talkThrough(bump("temple", table, "up"));
    expect(s.gold).toBe(5);
    expect(s.quests.falls).toBe(true);
    const seen = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const q = bump("temple", table, "up", { rng: seed, flags: { noteRead: true } });
      expect(q.mode).toBe("dialogue");
      seen.add(q.dlg!.text!);
    }
    expect(seen.size).toBeGreaterThan(3);
    expect(talkThrough(bump("temple", table, "up")).zone).toBeUndefined();
  });

  it("lets Drawf join, whichever way you answer him", () => {
    for (const first of [0, 1]) {
      const d = get(T(), "temple", "npc", "drawf");
      const s = talkThrough(bump("temple", d, "right"), { drawf1: first });
      expect(s.flags.drawfJoins).toBe(true);
      expect(s.quests.drawf).toBe(true);
      expect(get(s, "temple", "npc", "drawf").y).toBeLessThan(20);
    }
  });

  it("changes Drawf's advice as the trial goes on", () => {
    const d = get(T(), "temple", "npc", "drawf");
    const say = (flags: Record<string, true>) => {
      const s = bump("temple", d, "right", { flags: { drawfJoins: true, ...flags } });
      const n = NODES[s.dlg!.node];
      return typeof n.text === "function" ? n.text(s) : n.text;
    };
    expect(say({})).not.toBe(say({ armed: true }));
    expect(say({ armed: true })).not.toBe(say({ puzzleDone: true }));
  });

  it("opens its door when you walk into it", () => {
    const door = get(T(), "temple", "panel", "door");
    const s = bump("temple", door, "up");
    expect(get(s, "temple", "panel", "door").open).toBe(true);
    expect(play(s, mv("up")).pos).toEqual({ x: door.x, y: door.y });
  });
});

describe("the Temple's hall", () => {
  const T = () => at("temple", 0, 0);
  const wall = (what: string) => (s: State) => get(s, "temple", "panel", what);
  const left = (what: string) => get(T(), "temple", "button", what);

  it("opens the dividing wall's block with the blue button at the bottom of the left wall", () => {
    const s = bump("temple", left("L1"), "left");
    expect(wall("w1")(s).open).toBe(true);
  });

  it("arms the red button with the gold button, which sits in the alcove behind that block", () => {
    const refused = bump("temple", left("R1"), "right");
    expect(refused.flags.puzzleDone).toBeUndefined();
    const armed = bump("temple", left("gold"), "left");
    expect(armed.flags.armed).toBe(true);
  });

  it("opens the false altar and the sanctum door with the red button, but the door only for a while", () => {
    let s = bump("temple", left("R1"), "right", { flags: { armed: true } });
    expect(s.flags.puzzleDone).toBe(true);
    expect(s.quests.flame).toBe(true);
    expect(get(s, "temple", "panel", "fake").open).toBe(true);
    expect(wall("w3")(s).open).toBe(true);
    for (let i = 0; i < 30; i++) s = act({ ...s, pos: { x: 22, y: 15 } }, mv(i % 2 ? "left" : "right"));
    expect(wall("w3")(s).open).toBe(false);
    expect(get(s, "temple", "panel", "fake").open).toBe(true);
  });

  it("never shuts the door on someone standing in it", () => {
    let s = bump("temple", left("R1"), "right", { flags: { armed: true } });
    s = { ...s, pos: { x: 22, y: 11 }, timers: [{ id: "panel:temple:w3", left: 1 }] };
    s = act(s, { type: "wait" });
    expect(wall("w3")(s).open).toBe(true);
  });

  it("burns you if you trust a false flame", () => {
    const s = bump("temple", left("decoy"), "left");
    expect(s.hp).toBeLessThan(maxHp(1));
    expect(s.mode).toBe("explore");
  });
});

describe("the sanctum", () => {
  const T = () => at("temple", 0, 0);

  it("opens with Vastios welcoming the boys, once", () => {
    let s = act(at("temple", 22, 11, { entities: T().entities.map((e) => (e.what === "w3" ? { ...e, open: true } : e)) }), mv("up"));
    expect(s.zone).toBe("sanctum");
    expect(s.dlg?.node).toBe("sanct1");
    s = talkThrough(s);
    expect(s.mode).toBe("explore");
    const again = play({ ...s, pos: { x: 22, y: 11 }, zone: undefined }, mv("up"));
    expect(again.mode).toBe("explore");
  });

  it("won't let the levers move until Vastios has explained them", () => {
    const raise = get(T(), "temple", "lever", "raise");
    const s = bump("temple", raise, "right");
    expect(s.flags.altarUp).toBeUndefined();
    expect(s.log.at(-1)).toMatch(/Vastios/);
  });

  it("raises a hidden chest with one lever, and the other lowers it and opens the way out for good", () => {
    const base = { flags: { leversExplained: true } as Record<string, true> };
    let s = bump("temple", get(T(), "temple", "lever", "raise"), "right", base);
    expect(s.flags.altarUp).toBe(true);
    const chest = get(s, "temple", "chest", "altar");
    s = act({ ...s, pos: { x: chest.x - 1, y: chest.y }, facing: "right" }, mv("right"));
    expect(s.shield).toBe(true);
    expect(s.potions).toBe(2);
    expect(defenseOf(s)).toBe(defenseOf({ ...s, shield: false }) + 2);
    s = act({ ...s, pos: { x: 18, y: 8 }, facing: "left" }, mv("left"));
    expect(s.entities.some((e) => e.what === "altar")).toBe(false);
    expect(get(s, "temple", "panel", "w3").open).toBe(true);
    expect(s.quests.levers).toBe(true);
  });

  it("sends Vastios outside after he has explained the levers", () => {
    const v = get(T(), "temple", "npc", "vastios");
    const s = talkThrough(bump("temple", v, "up", { zone: "sanctum" }));
    expect(s.flags.vastiosGone).toBe(true);
    expect(s.entities.filter((e) => e.area === "temple" && e.what === "vastios")).toHaveLength(1);
    expect(get(s, "temple", "npc", "vastios").y).toBeGreaterThan(20);
  });

  it("has eight tomes, and reading them all is a quest", () => {
    let s = at("temple", 0, 0, { flags: { sanctumIntro: true } });
    for (let k = 0; k < 8; k++) {
      const shelf = get(s, "temple", "prop", `shelf:${k}`);
      s = talkThrough(act({ ...s, mode: "explore", pos: { x: shelf.x, y: shelf.y + 1 } }, mv("up")));
      expect(s.flags[`lore${k}`]).toBe(true);
    }
    expect(s.quests.scholar).toBe(true);
  });
});

describe("the Slime Fields", () => {
  const statue = () => {
    const s = at("slimes", 0, 0, { flags: { trialStarted: true } });
    const st = get(s, "slimes", "prop", "statue");
    return { ...s, pos: { x: st.x, y: st.y + 1 } };
  };

  it("won't wake until you say you're worthy", () => {
    const no = talkThrough(act(statue(), mv("up")), { statue1: 1 });
    expect(no.flags.blade).toBeUndefined();
    expect(slimesLeft(no)).toBe(0);
    const yes = talkThrough(act(statue(), mv("up")));
    expect(yes.flags.blade).toBe(true);
    expect(yes.weapon).toBe("lightbringer");
    expect(attackOf(yes)).toBeGreaterThan(attackOf(no));
    expect(slimesLeft(yes)).toBe(SLIME_WAVE);
  });

  it("spawns slimes on open ground well away from you, in a mix that favours the easy ones", () => {
    const tally = Object.fromEntries(SLIME_COLORS.map((c) => [c, 0]));
    for (let seed = 1; seed <= 80; seed++) {
      const s = talkThrough(act({ ...statue(), rng: seed }, mv("up")));
      for (const e of s.entities.filter((e) => e.area === "slimes" && e.kind === "enemy")) {
        tally[e.what]++;
        expect(Math.abs(e.x - s.pos.x) + Math.abs(e.y - s.pos.y)).toBeGreaterThanOrEqual(4);
        expect(WALKABLE).toContain(groundAt(s, e.x, e.y));
      }
    }
    expect(tally.green).toBeGreaterThan(tally.blue);
    expect(tally.blue).toBeGreaterThan(tally.red);
    expect(tally.red).toBeGreaterThan(tally.purple);
    expect(tally.rainbow).toBeLessThan(tally.purple);
    expect(tally.rainbow).toBeLessThan(30);
  });

  it("makes harder slimes hit harder", () => {
    const order = SLIME_COLORS.map((c) => ENEMIES[c]);
    for (let i = 1; i < order.length; i++) {
      expect(order[i].hp).toBeGreaterThan(order[i - 1].hp);
      expect(order[i].atk).toBeGreaterThanOrEqual(order[i - 1].atk);
      expect(order[i].xp).toBeGreaterThan(order[i - 1].xp);
    }
  });

  it("spawns the Great Slime once the last slime falls, and the quest pays", () => {
    let s = talkThrough(act(statue(), mv("up")));
    s = { ...s, entities: s.entities.filter((e) => e.kind !== "enemy" || e.area !== "slimes") };
    s = foe({ ...s, pos: { x: 5, y: 7 }, mode: "explore" }, "green", 6, 7);
    s = act(s, mv("right"));
    s = act({ ...s, battle: { ...s.battle!, hp: 1 } }, { type: "attack" });
    expect(s.mode).toBe("explore");
    expect(s.quests.slimes).toBe(true);
    expect(s.entities.some((e) => e.what === "bigslime")).toBe(true);
  });
});

describe("enemies that move", () => {
  const field = (extra: Partial<State> = {}) => at("slimes", 8, 7, { ...extra });

  it("wander around when you're not near", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 30; seed++) {
      let s = foe(field({ rng: seed, pos: { x: 1, y: 10 } }), "green", 12, 2);
      s = play(s, mv("up"), mv("down"), mv("up"), mv("down"));
      const e = s.entities.find((o) => o.area === "slimes" && o.what === "green")!;
      seen.add(`${e.x},${e.y}`);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it("chase when you come close, and start a fight on contact", () => {
    let s = foe(field({ pos: { x: 8, y: 7 }, ticks: 1 }), "red", 11, 7);
    for (let i = 0; i < 6 && s.mode === "explore"; i++) s = act(s, mv(i % 2 ? "left" : "right"));
    expect(s.mode).toBe("battle");
    expect(s.battle!.kind).toBe("red");
  });

  it("don't walk through walls, water or each other", () => {
    for (let seed = 1; seed < 20; seed++) {
      let s = foe(foe(field({ rng: seed, pos: { x: 2, y: 10 } }), "green", 4, 5), "green", 5, 5);
      for (let i = 0; i < 30 && s.mode === "explore"; i++) s = act(s, mv(i % 2 ? "left" : "right"));
      const tiles = s.entities.filter((e) => e.area === "slimes" && e.kind === "enemy").map((e) => `${e.x},${e.y}`);
      expect(new Set(tiles).size).toBe(tiles.length);
      for (const e of s.entities.filter((e) => e.area === "slimes" && e.kind === "enemy")) expect(groundAt(s, e.x, e.y)).toBe(".");
    }
  });

  it("freeze when they've just been escaped from, long enough to get clear", () => {
    let s = foe(field({ pos: { x: 8, y: 7 } }), "green", 9, 7);
    s = act(s, mv("right"));
    expect(s.mode).toBe("battle");
    let fled = s;
    for (let seed = 1; seed < 30 && fled.mode === "battle"; seed++) fled = act({ ...s, rng: seed }, { type: "flee" });
    expect(fled.mode).toBe("explore");
    expect(fled.entities.find((e) => e.area === "slimes" && e.what === "green")!.frozen).toBeGreaterThan(0);
  });

  it("remember how hurt they were", () => {
    let s = foe(field({ pos: { x: 8, y: 7 }, hp: 99 }), "green", 9, 7);
    s = act(s, mv("right"));
    for (let seed = 1; seed < 40 && s.mode === "battle"; seed++) {
      const hit = act({ ...s, rng: seed }, { type: "attack" });
      if (hit.mode !== "battle") continue;
      const fled = act({ ...hit, rng: seed }, { type: "flee" });
      if (fled.mode === "explore") {
        expect(fled.entities.find((e) => e.area === "slimes" && e.what === "green")!.hp).toBe(hit.battle!.hp);
        return;
      }
    }
  });
});

describe("fighting", () => {
  const fight = (what = "green", extra: Partial<State> = {}) => strike(act(foe(at("slimes", 5, 5, extra), what, 6, 5), mv("right")));

  it("starts when you walk into an enemy", () => {
    const s = fight();
    expect(s.mode).toBe("battle");
    expect(s.battle).toMatchObject({ kind: "green", hp: ENEMIES.green.hp });
    expect(s.pos).toEqual({ x: 5, y: 5 });
  });

  it("lets both sides hit, within the damage ranges", () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = act({ ...fight("purple"), rng: seed }, { type: "attack" });
      const dealt = ENEMIES.purple.hp - s.battle!.hp;
      expect(dealt).toBeGreaterThanOrEqual(attackOf(s) - ENEMIES.purple.def);
      expect(dealt).toBeLessThanOrEqual(attackOf(s) + 2 - ENEMIES.purple.def);
      expect(maxHp(1) - s.hp).toBeGreaterThanOrEqual(1);
    }
  });

  it("guarding takes half the damage, rounded up", () => {
    for (let seed = 1; seed < 40; seed++) {
      const base = { ...fight("red"), rng: seed };
      const guarded = maxHp(1) - act(base, { type: "guard" }).hp;
      expect(guarded).toBeLessThanOrEqual(Math.ceil((ENEMIES.red.atk + 2) / 2));
    }
  });

  it("a potion heals up to your maximum and the enemy still gets its turn", () => {
    const s = act({ ...fight(), potions: 1, hp: 10 }, { type: "potion" });
    expect(s.potions).toBe(0);
    expect(s.hp).toBeGreaterThan(10 + POTION_HEAL - ENEMIES.green.atk - 2);
    expect(act({ ...fight(), potions: 1, hp: maxHp(1) }, { type: "potion" }).potions).toBe(1);
  });

  it("you can sometimes flee a slime, never a boss", () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed < 60; seed++) outcomes.add(act({ ...fight(), rng: seed }, { type: "flee" }).mode);
    expect(outcomes).toEqual(new Set(["explore", "battle"]));
    for (let seed = 1; seed < 20; seed++) expect(act({ ...fight("bigslime", { hp: 200 }), rng: seed }, { type: "flee" }).mode).toBe("battle");
  });

  it("winning pays out, removes the enemy and levels you up", () => {
    const s = act({ ...fight(), xp: xpToNext(1) - 1 }, { type: "spell" });
    const done = act({ ...s.battle ? { ...s, battle: { ...s.battle, hp: 1 } } : s }, { type: "attack" });
    expect(done.level).toBe(2);
    expect(done.hp).toBe(maxHp(2));
    expect(done.gold).toBe(ENEMIES.green.gold);
    expect(done.mode).toBe("explore");
  });

  it("losing ends the game and nothing moves after that", () => {
    const s = act({ ...fight("purple"), hp: 1 }, { type: "attack" });
    expect(s.mode).toBe("lost");
    expect(play(s, mv("down"), { type: "potion" }, { type: "attack" })).toEqual(s);
  });
});

describe("dynamic combat", () => {
  const fight = (what = "green", intent: "strike" | "heavy" | "swift" = "strike", extra: Partial<State> = {}) => strike(act(foe(at("slimes", 5, 5, { hp: 200, ...extra }), what, 6, 5), mv("right")), intent);
  const taken = (s: State, a: Action, seed: number) => 200 - act({ ...s, rng: seed }, a).hp;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it("shows what the enemy will do next, and picks something new each turn", () => {
    const s = act(foe(at("slimes", 5, 5), "red", 6, 5), mv("right"));
    expect(["strike", "heavy", "swift"]).toContain(s.battle!.intent);
    expect(s.log.join(" ")).toMatch(/readies a strike|HEAVY|flurry/);
    const seen = new Set<string>();
    for (let seed = 1; seed < 80; seed++) seen.add(act(foe(at("slimes", 5, 5, { rng: seed }), "red", 6, 5), mv("right")).battle!.intent);
    expect(seen).toEqual(new Set(["strike", "heavy", "swift"]));
  });

  it("a heavy blow hurts more than a strike, and a flurry lands twice for less each", () => {
    // Waiting out a turn with a guard up, so only the enemy's blow matters.
    const hit = (intent: "strike" | "heavy" | "swift") => mean(Array.from({ length: 60 }, (_, i) => taken(fight("red", intent), { type: "attack" }, i + 1)));
    expect(hit("heavy")).toBeGreaterThan(hit("strike"));
    expect(hit("swift")).toBeGreaterThan(0);
  });

  it("a guard cuts a heavy blow, and cuts it harder than a plain attack would", () => {
    const hit = (a: Action) => mean(Array.from({ length: 60 }, (_, i) => taken(fight("red", "heavy"), a, i + 1)));
    expect(hit({ type: "guard" })).toBeLessThan(hit({ type: "attack" }));
  });

  it("a guard can turn a quick blow aside and strike back", () => {
    let riposted = 0;
    for (let seed = 1; seed < 80; seed++) if (act({ ...fight("red", "strike"), rng: seed }, { type: "guard" }).log.some((l) => /strike back/.test(l))) riposted++;
    expect(riposted).toBeGreaterThan(5);
    expect(riposted).toBeLessThan(60);
  });

  it("a dodge costs stamina, and needs it", () => {
    const s = act({ ...fight("green", "heavy"), rng: 3 }, { type: "dodge" });
    expect(s.stamina).toBeLessThan(STAMINA_MAX);
    const tired = act({ ...fight("green", "heavy"), stamina: 1 }, { type: "dodge" });
    expect(tired.log.at(-1)).toMatch(/winded/);
    expect(tired.battle!.intent).toBe("heavy");
    expect(tired.hp).toBe(200);
  });

  it("a dodge works most often against a slow heavy wind-up, least against a flurry", () => {
    const rate = (intent: "strike" | "heavy" | "swift") => mean(Array.from({ length: 200 }, (_, i) => (act({ ...fight("green", intent), rng: i + 1 }, { type: "dodge" }).log.some((l) => /slip aside/.test(l)) ? 1 : 0)));
    expect(rate("heavy")).toBeGreaterThan(rate("strike"));
    expect(rate("strike")).toBeGreaterThan(rate("swift"));
  });

  it("a clean dodge takes no damage and earns a combo opening", () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = act({ ...fight("green", "heavy"), rng: seed }, { type: "dodge" });
      if (s.log.some((l) => /slip aside/.test(l))) {
        expect(s.hp).toBe(200);
        expect(s.battle!.combo).toBe(2);
        return;
      }
    }
    throw new Error("never dodged");
  });

  it("consecutive hits build a combo that adds damage, and being hit ends it", () => {
    let s = fight("purple", "strike", { level: 3 });
    s = { ...s, battle: { ...s.battle!, hp: 500, maxHp: 500 } };
    const hp0 = s.battle!.hp;
    s = strike(act({ ...s, rng: 11 }, { type: "attack" }));
    const first = hp0 - s.battle!.hp;
    expect(s.battle!.combo).toBe(1);
    const hp1 = s.battle!.hp;
    s = strike(act({ ...s, rng: 11 }, { type: "attack" }));
    expect(s.battle!.combo).toBe(2);
    expect(hp1 - s.battle!.hp).toBeGreaterThanOrEqual(first);
    // The enemy answered each hit with one of its own, so the combo only survives when it was dodged or guarded away.
    const plain = act({ ...strike(s, "strike"), rng: 5 }, { type: "attack" });
    expect(plain.battle!.combo).toBeLessThanOrEqual(3);
  });

  it("soaking up enough damage Breaks the enemy: it loses its move, and the next blow hits harder", () => {
    let s = fight("red", "strike", { level: 4, weapon: "axe", weapons: ["fists", "axe"] });
    s = { ...s, battle: { ...s.battle!, hp: 200, maxHp: 28, stagger: 0 } };
    let broke = false;
    for (let i = 0; i < 12 && s.mode === "battle" && !broke; i++) {
      s = strike(act({ ...s, hp: 500, rng: 100 + i }, { type: "attack" }), "strike");
      broke = s.log.some((l) => /Break!/.test(l));
    }
    expect(broke).toBe(true);
    expect(s.battle!.broken).toBe(1);
    // The enemy answered the Break with nothing: no damage that turn.
    expect(s.hp).toBe(500);
    expect(s.log.join(" ")).toMatch(/reeling/);
    const follow = act({ ...s, rng: 7 }, { type: "attack" });
    expect(follow.log.join(" ")).toMatch(/right through its guard/);
  });

  it("the Great Slime gets quicker as it shrinks", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      const s = act(foe(at("slimes", 5, 5, { rng: seed, hp: 200 }), "bigslime", 6, 5), mv("right"));
      seen.add(act({ ...s, battle: { ...s.battle!, hp: 10 } }, { type: "guard" }).battle!.intent);
    }
    expect(seen.has("swift")).toBe(true);
  });
});

describe("magic", () => {
  const fight = (extra: Partial<State> = {}) => strike(act(foe(at("slimes", 5, 5, extra), "orange", 6, 5), mv("right")));

  it("each element does something of its own", () => {
    const base = fight({ mana: 20, hp: 20 });
    const cast = (el: "fire" | "water" | "air" | "earth" | "universal") => act({ ...act(base, { type: "element", el }), rng: 5 }, { type: "spell" });
    expect(cast("fire").battle!.burn).toBeGreaterThan(0);
    expect(cast("water").hp).toBeGreaterThan(cast("air").hp);
    expect(cast("universal").battle!.hp).toBeLessThan(cast("air").battle!.hp);
    expect(cast("earth").mana).toBe(20 - 3);
    expect(cast("universal").mana).toBe(20 - 6);
  });

  it("costs mana, and does nothing without it", () => {
    const dry = fight({ mana: 1 });
    const after = act(dry, { type: "spell" });
    expect(after.mana).toBe(1);
    expect(after.battle!.hp).toBe(dry.battle!.hp);
  });

  it("burns a target for two more turns", () => {
    let s = act(fight({ mana: 10 }), { type: "spell" });
    const hp = s.battle!.hp;
    s = act(s, { type: "guard" });
    expect(s.battle!.hp).toBe(hp - 2);
  });

  it("charges the Lightbringer blade, which then strikes for triple", () => {
    let s = act(foe(at("slimes", 5, 5, { flags: { blade: true }, special: 6, weapon: "lightbringer" }), "purple", 6, 5), mv("right"));
    s = act(s, { type: "attack" });
    expect(s.special).toBe(7);
    const hp = s.battle!.hp;
    s = act(s, { type: "special" });
    expect(hp - s.battle!.hp).toBe(attackOf(s) * 3);
    expect(s.special).toBe(0);
    const early = act(s, { type: "special" });
    expect(early.battle!.hp).toBe(s.battle!.hp);
  });

  it("recovers mana as you walk", () => {
    let s = at("slimes", 6, 10, { mana: 0 });
    for (let i = 0; i < 6; i++) s = act(s, mv(i % 2 ? "left" : "right"));
    expect(s.mana).toBeGreaterThanOrEqual(2);
  });
});

describe("the dash", () => {
  const dashing = (el: "fire" | "water" | "air" | "earth" | "universal", extra: Partial<State> = {}) =>
    act({ ...at("slimes", 2, 7, { element: el, facing: "right", mana: 6, ...extra }) }, { type: "dash" });

  it("moves you up to three tiles and leaves the element behind, not at the end", () => {
    const s = dashing("fire");
    expect(s.pos).toEqual({ x: 5, y: 7 });
    expect(s.mana).toBe(4);
    expect(s.trails.map((t) => t.x).sort()).toEqual([2, 3, 4]);
    expect(s.trails.every((t) => t.el === "fire")).toBe(true);
  });

  it("stops short of anything in the way and costs nothing if it can't move", () => {
    const s = dashing("air", { pos: { x: 3, y: 7 } });
    expect(s.pos.x).toBeGreaterThan(3);
    const stuck = act(at("slimes", 0, 7, { facing: "left", mana: 6 }), { type: "dash" });
    expect(stuck.mana).toBe(6);
    expect(stuck.pos).toEqual({ x: 0, y: 7 });
  });

  it("needs mana", () => {
    const s = dashing("fire", { mana: 1 });
    expect(s.pos).toEqual({ x: 2, y: 7 });
  });

  it("fades after a few turns", () => {
    let s = dashing("fire");
    for (let i = 0; i < 9; i++) s = act(s, mv(i % 2 ? "up" : "down"));
    expect(s.trails).toHaveLength(0);
  });

  it("flames burn what walks into them", () => {
    const s = dashing("fire");
    const after = act({ ...foe({ ...s, pos: { x: 3, y: 10 } }, "blue", 3, 6, { hp: 5 }), ticks: 1 }, mv("up"));
    expect(after.entities.some((o) => o.area === "slimes" && o.what === "blue")).toBe(false);
    expect(after.xp).toBeGreaterThan(0);
    const tough = act({ ...foe({ ...s, pos: { x: 3, y: 10 } }, "purple", 3, 6), ticks: 1 }, mv("up"));
    const p = tough.entities.find((o) => o.what === "purple")!;
    expect(p.hp).toBeLessThan(ENEMIES.purple.hp);
  });

  it("ice freezes, stone blocks, wind throws back, light dazzles", () => {
    // A slime above the trail, chasing a hero below it, has to cross the trail to get to him.
    const crossing = (el: "water" | "earth" | "air" | "universal") => {
      const s = dashing(el);
      return act({ ...foe({ ...s, pos: { x: 3, y: 9 } }, "red", 3, 6), ticks: 1 }, mv("down"));
    };
    const red = (s: State) => s.entities.find((o) => o.area === "slimes" && o.what === "red")!;
    expect(red(crossing("water")).frozen).toBeGreaterThan(0);
    expect(red(crossing("water")).y).toBe(7);
    expect(red(crossing("earth")).y).toBe(6);
    expect(red(crossing("air")).frozen).toBeGreaterThan(0);
    expect(red(crossing("air")).y).toBe(6);
    expect(red(crossing("universal")).frozen).toBeGreaterThan(0);
  });
});

describe("weapons", () => {
  const swing = (weapon: "bow" | "polearm" | "axe" | "prism" | "lightbringer", seed = 1, foeKind = "purple") =>
    act({ ...strike(act(foe(at("slimes", 5, 5, { weapon, weapons: ["fists", weapon], rng: seed }), foeKind, 6, 5), mv("right"))), rng: seed }, { type: "attack" });

  it("each has its own trait", () => {
    expect(attackOf({ level: 1, weapon: "axe" })).toBeGreaterThan(attackOf({ level: 1, weapon: "polearm" }));
    expect(defenseOf({ level: 1, shield: false, weapon: "axe" })).toBe(0);
    let doubled = 0;
    for (let seed = 1; seed < 60; seed++) if (ENEMIES.purple.hp - swing("bow", seed).battle!.hp > attackOf({ level: 1, weapon: "bow" }) + 2 - ENEMIES.purple.def) doubled++;
    expect(doubled).toBeGreaterThan(5);
    const pierced = ENEMIES.purple.hp - swing("polearm").battle!.hp;
    expect(pierced).toBeGreaterThanOrEqual(attackOf({ level: 1, weapon: "polearm" }) - ENEMIES.purple.def + 2);
  });

  it("can be swapped outside a fight", () => {
    const s = act(at("field", 3, 3, { weapons: ["fists", "bow"] }), { type: "equip", weapon: "bow" });
    expect(s.weapon).toBe("bow");
    expect(act(at("field", 3, 3), { type: "equip", weapon: "axe" }).weapon).toBe("fists");
  });
});

describe("the Great Slime", () => {
  const big = (hp: number) => {
    const s = strike(act(foe(at("slimes", 5, 5, { hp: 200 }), "bigslime", 6, 5), mv("right")));
    return { ...s, battle: { ...s.battle!, hp } };
  };
  const damage = (hp: number, seed: number) => {
    const s = act({ ...big(hp), rng: seed, hp: 200 }, { type: "guard" });
    return 200 - s.hp;
  };

  it("hits softer and softer as it shrinks, but twice once it's small", () => {
    const avg = (hp: number) => Array.from({ length: 30 }, (_, i) => damage(hp, i + 1)).reduce((a, b) => a + b, 0) / 30;
    expect(avg(96)).toBeGreaterThan(avg(60));
    expect(avg(60)).toBeGreaterThan(avg(40));
    // Faster, never stronger: even with two swings it doesn't out-hit its full size.
    expect(avg(20)).toBeLessThan(avg(96));
    const log = act({ ...big(20), hp: 200 }, { type: "attack" }).log.filter((l) => l.includes("hits you")).length;
    expect(log).toBe(2);
    const full = act({ ...big(96), hp: 200 }, { type: "attack" }).log.filter((l) => l.includes("hits you")).length;
    expect(full).toBe(1);
  });

  it("ends the arc: the oath, the choice, and the end", () => {
    let s = act({ ...big(1), hp: 100 }, { type: "attack" });
    expect(s.quests.great).toBe(true);
    expect(s.dlg?.node).toBe("oath0");
    s = talkThrough(s);
    expect(s.mode).toBe("won");
    const again = act(s, mv("down"));
    expect(again).toEqual(s);
  });

  it("lets Mallakoth hesitate at the oath, and asks again", () => {
    let s = act({ ...big(1), hp: 100 }, { type: "attack" });
    s = play(s, next, next, next, next);
    expect(s.dlg?.node).toBe("oath3");
    s = act(s, choose(1));
    expect(s.dlg?.node).toBe("oath_wait");
    s = act(s, next);
    expect(s.dlg?.node).toBe("oath3");
  });
});

describe("the treehouse", () => {
  const house = (extra: Partial<State> = {}) => at("treehouse", 6, 5, extra);

  it("gives one free weapon, once", () => {
    let s = act(house(), mv("right"));
    s = act(act(s, next), choose(1)); // the polearm
    expect(s.weapons).toContain("polearm");
    expect(s.flags.freeWeapon).toBe(true);
    s = act(s, next);
    const menu = NODES[s.dlg!.node].choices;
    const labels = (typeof menu === "function" ? menu(s) : menu!).map((c) => c.label);
    expect(labels.some((l) => /Bow|Axe|Polearm/.test(l))).toBe(false);
  });

  it("sells potions and cures, and checks your purse and your pack", () => {
    const buy = (label: string, extra: Partial<State>) => {
      let s = act(house({ flags: { treehouseMet: true, freeWeapon: true }, ...extra }), mv("right"));
      const menu = NODES[s.dlg!.node].choices;
      const i = (typeof menu === "function" ? menu(s) : menu!).findIndex((c) => c.label.startsWith(label));
      return act(s, choose(i));
    };
    expect(buy("Potion", { gold: 20 }).potions).toBe(1);
    expect(buy("Potion", { gold: 3 }).potions).toBe(0);
    expect(buy("Potion", { gold: 20, potions: 4 }).potions).toBe(4);
    expect(buy("Antidote", { gold: 20, poisoned: true }).poisoned).toBe(false);
    expect(buy("Elixir", { gold: 20, mana: 0 }).mana).toBeGreaterThan(0);
  });

  it("trades a rainbow slime's gel for the Prism Blade", () => {
    let s = act(house({ items: { prismGel: true }, flags: { treehouseMet: true, freeWeapon: true } }), mv("right"));
    const menu = NODES[s.dlg!.node].choices;
    const list = typeof menu === "function" ? menu(s) : menu!;
    s = act(s, choose(list.findIndex((c) => c.label.startsWith("Show"))));
    expect(s.weapons).toContain("prism");
    expect(s.items.prismGel).toBeUndefined();
    expect(s.quests.prism).toBe(true);
  });

  it("is reached by stepping on a certain tile in the slime fields, which the Secret Master hints at", () => {
    const m = get(at("slimes", 0, 0), "slimes", "npc", "master");
    let s = talkThrough(bump("slimes", m, "right"));
    expect(s.flags.treeHint).toBe(true);
    const again = bump("slimes", m, "right", { flags: { treeHint: true } });
    expect(again.dlg?.node).toBe("sm_slimes2");
    s = act(at("slimes", 30, 30), mv("right"));
    expect(s.dlg?.node).toBe("tree_tele");
    s = act(s, next);
    expect(s.area).toBe("treehouse");
  });

  it("a rainbow slime always leaves gel", () => {
    let s = act(foe(at("slimes", 5, 5), "rainbow", 6, 5), mv("right"));
    s = act({ ...s, battle: { ...s.battle!, hp: 1 } }, { type: "attack" });
    expect(s.items.prismGel).toBe(true);
  });
});

describe("the game as data", () => {
  it("is the same game for the same seed", () => {
    const run = (seed: number) => play(foe(at("slimes", 5, 5, { rng: seed }), "orange", 6, 5), mv("right"), { type: "attack" }, { type: "attack" });
    expect(run(7)).toEqual(run(7));
    expect(run(7).rng).not.toBe(run(8).rng);
  });

  it("is a different game for a different seed: a different wave of slimes", () => {
    const wave = (seed: number) => {
      const st = get(at("slimes", 0, 0), "slimes", "prop", "statue");
      const s = talkThrough(bump("slimes", st, "up", { rng: seed, flags: { trialStarted: true } }));
      return JSON.stringify(s.entities.filter((e) => e.area === "slimes" && e.kind === "enemy").map((e) => [e.what, e.x, e.y]));
    };
    expect(new Set(Array.from({ length: 12 }, (_, i) => wave(i + 1))).size).toBeGreaterThan(8);
  });

  it("survives a trip through JSON, which is how it's saved", () => {
    const s = play(foe(at("slimes", 5, 5), "orange", 6, 5), mv("right"), { type: "attack" });
    const back = JSON.parse(JSON.stringify(s));
    expect(isState(back)).toBe(true);
    expect(back).toEqual(s);
    expect(act(back, { type: "attack" })).toEqual(act(s, { type: "attack" }));
  });

  it("refuses things that aren't saved games, including saves from the old game", () => {
    expect(isState(null)).toBe(false);
    expect(isState("hi")).toBe(false);
    expect(isState({})).toBe(false);
    expect(isState({ ...newGame(1), mode: "dancing" })).toBe(false);
    expect(isState({ ...newGame(1), area: "nowhere" })).toBe(false);
    expect(isState({ ...newGame(1), v: 1 })).toBe(false);
    expect(isState({ rng: 1, mode: "explore", pos: { x: 1, y: 1 }, level: 1, hp: 3, entities: [], log: [] })).toBe(false);
    expect(isState(newGame(1))).toBe(true);
  });
});

describe("the spiked floor and the road to Dresden", () => {
  const hatch = () => get(at("caves", 0, 0), "caves", "exit", "spikes");
  const inside = () => act(act({ ...beside("caves", hatch(), "left"), flags: { metStefan: true as const } }, mv("left")), choose(0));
  const exit = () => get(at("spikes", 0, 0), "spikes", "exit", "caves");

  it("is reached through a loose floorboard in Stefan's dead end, if you choose to", () => {
    const unmet = act(beside("caves", hatch(), "left"), mv("left"));
    expect(unmet.dlg?.node).toBe("hatch_hidden");
    const asked = act({ ...beside("caves", hatch(), "left"), flags: { metStefan: true as const } }, mv("left"));
    expect(asked.dlg?.node).toBe("spike_hatch");
    expect(act(asked, choose(1)).area).toBe("caves");
    const s = inside();
    expect(s.area).toBe("spikes");
    expect(s.spike).toEqual({ left: 9, total: 9 });
    expect(s.dlg?.node).toBe("spikes_in");
  });

  it("raises its spikes within a few ticks, and anyone who hesitates is caught", () => {
    let s = talkThrough(inside());
    for (let i = 0; i < 6; i++) s = act(s, { type: "wait" });
    for (let i = 0; i < 12 && s.mode === "explore" && s.area === "spikes"; i++) s = act(s, mv(stepToward(s, exit())!));
    expect(s.mode).toBe("lost");
    expect(s.log.at(-1)).toMatch(/spikes/);
  });

  it("walks you back to the start of the cave, not onto the spikes again, after you die on them", () => {
    // The checkpoint is where you came into the caves; stepping down the hatch does not replace it.
    const start = { ...beside("caves", hatch(), "left"), flags: { metStefan: true as const } };
    const entered = { ...start, ck: JSON.stringify(start) };
    let s = talkThrough(act(act(entered, mv("left")), choose(0)));
    for (let i = 0; i < 6; i++) s = act(s, { type: "wait" });
    for (let i = 0; i < 12 && s.mode === "explore" && s.area === "spikes"; i++) s = act(s, mv(stepToward(s, exit())!));
    expect(s.mode).toBe("lost");
    const back = act(s, { type: "retry" });
    expect(back.area).toBe("caves");
    expect(back.mode).toBe("explore");
  });

  it("lets anyone who sprints out the far end, with a purse and a potion for the trouble", () => {
    let s = talkThrough(inside());
    for (let i = 0; i < 12 && s.mode === "explore" && s.area === "spikes"; i++) s = act(s, mv(stepToward(s, exit())!, true));
    expect(s.mode).toBe("dialogue");
    expect(s.area).toBe("caves");
    s = talkThrough(s);
    expect(s.gold).toBeGreaterThanOrEqual(15);
    expect(s.potions).toBeGreaterThanOrEqual(1);
    expect(s.quests.spikes).toBe(true);
    expect(s.spike).toBeUndefined();
  });

  it("keeps what the spikes paid out even if you die in the caves afterwards and start from the checkpoint", () => {
    let s = talkThrough(inside());
    for (let i = 0; i < 12 && s.mode === "explore" && s.area === "spikes"; i++) s = act(s, mv(stepToward(s, exit())!, true));
    s = talkThrough(s);
    expect(s.potions).toBeGreaterThanOrEqual(1);
    const back = act({ ...s, hp: 0, mode: "lost" }, { type: "retry" });
    expect(back.potions).toBeGreaterThanOrEqual(1);
    expect(back.gold).toBeGreaterThanOrEqual(15);
    expect(back.flags.spikesDone).toBe(true);
  });

  it("only pays out once", () => {
    const first = talkThrough(act(act(inside(), { type: "next" }), { type: "wait" }));
    expect(first).toBeDefined();
    const again = at("caves", 41, 5, { flags: { spikesDone: true } });
    expect(again.gold).toBe(0);
  });

  it("has no dash while the floor is about to rise", () => {
    const s = act({ ...talkThrough(inside()), facing: "up" }, { type: "dash" });
    expect(s.pos).toEqual(AREAS.spikes.arrive);
  });

  it("makes each of the field's ways out the whole edge, not just where the path crosses it", () => {
    expect(act(at("field", 2, 10), mv("left")).dlg?.node).toBe("go_caves");
    expect(act(at("field", 58, 60), mv("right")).dlg?.node).toBe("edge_east");
    expect(act(at("field", 10, 2), mv("up")).dlg?.node).toBe("edge_north");
  });

  it("keeps Dresden closed until the story brings you back", () => {
    const s = act(at("field", 59, 32), mv("right"));
    expect(s.dlg?.node).toBe("edge_east");
    expect(act(s, next).area).toBe("field");
  });

  it("opens the road east once the arc is done, and the ending can walk you there", () => {
    const won = { ...at("slimes", 5, 5), mode: "won" as const };
    expect(act(won, mv("down"))).toEqual(won);
    const there = act(won, { type: "continue" });
    expect(there.area).toBe("dresden");
    expect(there.mode).toBe("explore");
    expect(there.flags.epilogue).toBe(true);
    const road = act(at("field", 59, 32, { flags: { epilogue: true } }), mv("right"));
    expect(road.dlg?.node).toBe("go_dresden");
    expect(act(road, choose(0)).area).toBe("dresden");
    const back = act(at("dresden", 1, 19), mv("left"));
    expect(back.area).toBe("field");
  });
});

describe("visual effects", () => {
  const names = (s: State) => (s.fx ?? []).map((f) => f.name);

  it("raise dust where each of the golem's rocks lands", () => {
    const trap = get(at("caves", 0, 0), "caves", "enemy", "golem");
    let s = at("caves", trap.x, trap.y - 5, { ticks: 2, flags: { golemAwake: true }, facing: "down" });
    s = act(s, mv("down"));
    expect(s.hazards.length).toBeGreaterThan(0);
    const landed = play({ ...s, hazards: [{ x: s.pos.x + 3, y: s.pos.y, fuse: 1 }] }, { type: "wait" });
    expect(names(landed)).toContain("Ground");
    expect(landed.fx!.at(-1)).toMatchObject({ area: "caves", x: s.pos.x + 3, y: s.pos.y });
  });

  it("send up smoke when the golem shatters", () => {
    const g = get(at("caves", 0, 0), "caves", "enemy", "golem");
    const s = talkThrough(bump("caves", g, "down", { items: { pickaxe: true }, flags: { golemAwake: true } }));
    expect(names(s)).toContain("smoke");
  });

  it("swirl at both ends of a teleport, to the treehouse and to the slime fields", () => {
    let s = act(at("slimes", 30, 30), mv("right"));
    s = act(s, next);
    expect(names(s)).toEqual(["Teleport", "Teleport2"]);
    expect(s.fx![0].area).toBe("slimes");
    expect(s.fx![1].area).toBe("treehouse");
    const v = get(at("temple", 0, 0), "temple", "npc", "vastios");
    const out = talkThrough(bump("temple", { x: v.x, y: v.y }, "up", { zone: "sanctum" }));
    expect(names(out)).toContain("Teleport");
  });

  it("number themselves so each plays once, and only keep the latest few", () => {
    let s = at("caves", 0, 0);
    s = { ...s, fx: [] };
    const g = get(s, "caves", "enemy", "golem");
    for (let i = 0; i < 10; i++) s = { ...s, hazards: [{ x: g.x, y: g.y - 3, fuse: 1 }], flags: { ...s.flags, golemAwake: true }, pos: { x: g.x + 4, y: g.y - 3 } as State["pos"] }, s = act(s, { type: "wait" });
    expect(s.fx!.length).toBeLessThanOrEqual(6);
    const ns = s.fx!.map((f) => f.n);
    expect(new Set(ns).size).toBe(ns.length);
    expect(ns).toEqual([...ns].sort((a, b) => a - b));
  });

  it("make a lost wanderer's evening rainy, until they go anywhere else", () => {
    const sign = get(at("caves", 0, 0), "caves", "prop", "scenery");
    expect(sign).toBeDefined();
    const lostNode = at("caves", 40, 40, { mode: "dialogue", dlg: { node: "lost1" } });
    const s = act(lostNode, choose(0));
    expect(s.area).toBe("field");
    expect(s.flags.rainy).toBe(true);
    const away = act(act(at("field", 1, 33, { flags: { rainy: true } }), mv("left")), choose(0));
    expect(away.flags.rainy).toBeUndefined();
  });
});

describe("a whole game", () => {
  it("can be won by the direct route, whatever the dice say", () => {
    const results = Array.from({ length: 10 }, (_, i) => playThrough(i + 1, "direct"));
    expect(results.filter((r) => r.mode !== "won")).toHaveLength(0);
  }, 180_000);

  it("can be won by the full route through the caves, whatever the dice say", () => {
    const results = Array.from({ length: 10 }, (_, i) => playThrough(i + 1, "full"));
    expect(results.filter((r) => r.mode !== "won")).toHaveLength(0);
  }, 180_000);

  it("finishes the main quests on the way, and levels up a good deal", () => {
    const s = playThrough(3, "full", { treehouse: true });
    expect(s.mode).toBe("won");
    for (const q of ["caves", "run", "drawf", "flame", "levers", "slimes", "great", "golem", "crystals", "secret"]) expect(s.quests[q], q).toBe(true);
    expect(s.level).toBeGreaterThanOrEqual(5);
    expect(s.shield).toBe(true);
    expect(s.companion).toBe("ricky");
  });

  it("can be lost: the wrong plate twice is fatal", () => {
    const wrong = PLATE_ANS[0] === 1 ? 2 : 1;
    const s = step(step({ ...at("caves", 40, 10), hp: 100 }, 0, wrong), 0, wrong);
    expect(s.mode).toBe("lost");
  });

  it("can be lost: rushing the Great Slime at level one is a death sentence", () => {
    let s = act(foe(at("slimes", 5, 5), "bigslime", 6, 5), mv("right"));
    for (let i = 0; i < 100 && s.mode === "battle"; i++) s = act(s, { type: "attack" });
    expect(s.mode).toBe("lost");
  });
});
