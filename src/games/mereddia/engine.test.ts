import { describe, expect, it } from "vitest";
import {
  POTION_HEAL,
  POTION_PRICE,
  SWORD_PRICE,
  act,
  attackOf,
  entityAt,
  groundAt,
  isState,
  maxHp,
  newGame,
  xpToNext,
  type Action,
  type Dir,
  type State,
} from "./engine";
import { ENEMIES, HEIGHT, MAP, WIDTH, parseMap, type Entity } from "./world";
import { playThrough, stepToward } from "./bot";

const play = (s: State, ...actions: Action[]) => actions.reduce(act, s);
const mv = (dir: Dir): Action => ({ type: "move", dir });

// A game with the hero standing at (x, y), for putting things next to him.
const at = (x: number, y: number, extra: Partial<State> = {}): State => ({ ...newGame(1), pos: { x, y }, ...extra });
const put = (s: State, e: Entity): State => ({ ...s, entities: [...s.entities, e] });
const enemy = (kind: string, x: number, y: number): Entity => ({ id: `enemy:test-${x},${y}`, kind: "enemy", what: kind, x, y });

describe("the map", () => {
  const { ground, start, entities } = parseMap();

  it("is a rectangle with a solid edge", () => {
    expect(MAP.every((r) => r.length === WIDTH)).toBe(true);
    expect(ground).toHaveLength(HEIGHT);
    for (let x = 0; x < WIDTH; x++) {
      expect(groundAt(x, 0)).toBe("#");
      expect(groundAt(x, HEIGHT - 1)).toBe("#");
    }
    for (let y = 0; y < HEIGHT; y++) {
      expect(groundAt(0, y)).toBe("#");
      expect(groundAt(WIDTH - 1, y)).toBe("#");
    }
  });

  it("starts the hero on open ground, on his own", () => {
    expect(groundAt(start.x, start.y)).toBe(".");
    expect(entityAt({ entities }, start.x, start.y)).toBeUndefined();
  });

  it("has unique entities, each on open ground", () => {
    expect(new Set(entities.map((e) => e.id)).size).toBe(entities.length);
    for (const e of entities) expect(groundAt(e.x, e.y)).toBe(".");
  });

  it("has what the story needs", () => {
    const count = (kind: string, what?: string) => entities.filter((e) => e.kind === kind && (what === undefined || e.what === what)).length;
    expect(count("enemy", "slime")).toBe(3);
    expect(count("enemy", "golem")).toBe(1);
    expect(count("enemy", "keeper")).toBe(1);
    expect(count("enemy", "mallakoth")).toBe(1);
    expect(count("chest")).toBe(3);
    expect(count("gate")).toBe(1);
    expect(count("npc")).toBe(2);
  });

  it("treats anything off the map as a wall", () => {
    expect(groundAt(-1, 3)).toBe("#");
    expect(groundAt(3, -1)).toBe("#");
    expect(groundAt(WIDTH, 3)).toBe("#");
    expect(groundAt(3, HEIGHT)).toBe("#");
  });
});

describe("exploring", () => {
  it("moves one tile at a time and counts steps", () => {
    const s = play(at(1, 3), mv("down"), mv("down"));
    expect(s.pos).toEqual({ x: 1, y: 5 });
    expect(s.steps).toBe(2);
  });

  it("is stopped by trees and water", () => {
    expect(play(at(1, 1), mv("up")).pos).toEqual({ x: 1, y: 1 });
    expect(play(at(3, 3), mv("right")).pos).toEqual({ x: 3, y: 3 });
  });

  it("doesn't change the state it was given", () => {
    const before = at(1, 3);
    const copy = structuredClone(before);
    act(before, mv("down"));
    expect(before).toEqual(copy);
  });

  it("ignores attacks and next while exploring", () => {
    const s = at(1, 3);
    expect(play(s, { type: "attack" }, { type: "next" }, { type: "guard" })).toEqual(s);
  });

  it("keeps only the last few log lines", () => {
    let s = at(1, 1);
    for (let i = 0; i < 12; i++) s = act(s, { type: "potion" });
    expect(s.log.length).toBeLessThanOrEqual(5);
  });
});

describe("talking", () => {
  it("Vastios tells the story and hands over potions once", () => {
    let s = at(4, 2); // below Vastios at (4,1)
    s = act(s, mv("up"));
    expect(s.mode).toBe("dialogue");
    expect(s.dialogue?.speaker).toBe("Vastios");
    expect(s.potions).toBe(2);
    s = play(s, { type: "next" }, { type: "next" });
    expect(s.mode).toBe("explore");
    expect(s.dialogue).toBeUndefined();
    s = act(s, mv("up"));
    expect(s.potions).toBe(2);
    expect(s.dialogue?.lines).toHaveLength(1);
  });

  it("doesn't let you walk while a conversation is open", () => {
    const s = act(at(4, 2), mv("up"));
    expect(play(s, mv("down")).pos).toEqual({ x: 4, y: 2 });
  });

  it("the Dwarf wants coins for a sword, and takes them", () => {
    const poor = act(at(2, 4, { gold: SWORD_PRICE - 1 }), mv("down"));
    expect(poor.sword).toBe(false);
    expect(poor.gold).toBe(SWORD_PRICE - 1);
    const rich = act(at(2, 4, { gold: SWORD_PRICE + 3 }), mv("down"));
    expect(rich.sword).toBe(true);
    expect(rich.gold).toBe(3);
    expect(attackOf(rich)).toBe(attackOf(at(2, 4)) + 3);
    const again = play({ ...rich, mode: "explore", dialogue: undefined }, mv("down"));
    expect(again.gold).toBe(3);
  });
});

describe("chests and the gate", () => {
  it("a chest gives its loot once", () => {
    let s = act(at(14, 4), mv("down")); // the crystals chest is at (14,5)
    expect(s.crystals).toBe(2);
    expect(s.gold).toBe(10);
    s = act(s, mv("down"));
    expect(s.crystals).toBe(2);
    expect(s.log.at(-1)).toMatch(/empty/);
  });

  it("the gate stays shut without a key and opens, once, with one", () => {
    const shut = act(at(8, 5), mv("down"));
    expect(shut.entities.some((e) => e.kind === "gate")).toBe(true);
    expect(shut.pos).toEqual({ x: 8, y: 5 });
    const open = act(at(8, 5, { keys: 1 }), mv("down"));
    expect(open.keys).toBe(0);
    expect(open.entities.some((e) => e.kind === "gate")).toBe(false);
    expect(act(open, mv("down")).pos).toEqual({ x: 8, y: 6 });
  });
});

describe("fighting", () => {
  const slimeFight = () => act(put(at(5, 5), enemy("slime", 6, 5)), mv("right"));

  it("starts when you walk into an enemy", () => {
    const s = slimeFight();
    expect(s.mode).toBe("battle");
    expect(s.battle).toMatchObject({ kind: "slime", hp: ENEMIES.slime.hp });
    expect(s.pos).toEqual({ x: 5, y: 5 });
  });

  it("lets both sides hit, within the damage ranges", () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = act({ ...slimeFight(), rng: seed }, { type: "attack" });
      const dealt = ENEMIES.slime.hp - s.battle!.hp;
      expect(dealt).toBeGreaterThanOrEqual(attackOf(s));
      expect(dealt).toBeLessThanOrEqual(attackOf(s) + 2);
      const taken = maxHp(1) - s.hp;
      expect(taken).toBeGreaterThanOrEqual(ENEMIES.slime.atk - 1);
      expect(taken).toBeLessThanOrEqual(ENEMIES.slime.atk + 1);
    }
  });

  it("guarding takes half the damage, rounded up", () => {
    for (let seed = 1; seed < 40; seed++) {
      const base = { ...slimeFight(), rng: seed };
      const plain = maxHp(1) - act(base, { type: "attack" }).hp;
      const guarded = maxHp(1) - act(base, { type: "guard" }).hp;
      // Attacking rolls once for the player first, so only the guard's own bounds are checked.
      expect(guarded).toBeGreaterThanOrEqual(Math.ceil((ENEMIES.slime.atk - 1) / 2));
      expect(guarded).toBeLessThanOrEqual(Math.ceil((ENEMIES.slime.atk + 1) / 2));
      expect(guarded).toBeLessThan(plain + 3);
    }
  });

  it("a crystal hits hard, ignores armor and is used up", () => {
    const s = act({ ...slimeFight(), crystals: 1 }, { type: "crystal" });
    expect(s.crystals).toBe(0);
    expect(s.mode).toBe("explore"); // 4*2+2 = 10 kills a 10 hp slime
    const golem = act({ ...act(put(at(5, 5), enemy("golem", 6, 5)), mv("right")), crystals: 1 }, { type: "crystal" });
    expect(golem.battle!.hp).toBe(ENEMIES.golem.hp - (attackOf(golem) * 2 + 2));
  });

  it("a crystal you don't have costs you nothing", () => {
    const before = slimeFight();
    const after = act(before, { type: "crystal" });
    expect(after.hp).toBe(before.hp);
    expect(after.battle!.hp).toBe(before.battle!.hp);
  });

  it("a potion heals up to your maximum and the enemy still gets its turn", () => {
    const s = act({ ...slimeFight(), potions: 1, hp: 10 }, { type: "potion" });
    expect(s.potions).toBe(0);
    expect(s.hp).toBeGreaterThan(10 + POTION_HEAL - ENEMIES.slime.atk - 2);
    const topped = act({ ...slimeFight(), potions: 1, hp: maxHp(1) }, { type: "potion" });
    expect(topped.potions).toBe(1);
    expect(topped.hp).toBe(maxHp(1));
  });

  it("potions work outside a fight too, and don't overheal", () => {
    const s = act(at(1, 1, { potions: 1, hp: maxHp(1) - 4 }), { type: "potion" });
    expect(s.hp).toBe(maxHp(1));
    expect(s.potions).toBe(0);
  });

  it("you can sometimes flee a slime, never a boss", () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed < 60; seed++) outcomes.add(act({ ...slimeFight(), rng: seed }, { type: "flee" }).mode);
    expect(outcomes).toEqual(new Set(["explore", "battle"]));
    for (let seed = 1; seed < 20; seed++) {
      const boss = act(put(at(5, 5), enemy("keeper", 6, 5)), mv("right"));
      expect(act({ ...boss, rng: seed }, { type: "flee" }).mode).toBe("battle");
    }
  });

  it("winning pays out, removes the enemy and levels you up", () => {
    const s = act({ ...slimeFight(), xp: xpToNext(1) - 1, crystals: 1 }, { type: "crystal" });
    expect(s.level).toBe(2);
    expect(s.hp).toBe(maxHp(2));
    expect(s.xp).toBe(ENEMIES.slime.xp - 1);
    expect(s.gold).toBe(ENEMIES.slime.gold);
    expect(entityAt(s, 6, 5)).toBeUndefined();
    expect(s.mode).toBe("explore");
    expect(s.battle).toBeUndefined();
  });

  it("can level up more than once from one fight", () => {
    const s = act({ ...act(put(at(5, 5), enemy("keeper", 6, 5)), mv("right")), crystals: 9, level: 5 }, { type: "crystal" });
    expect(s.level).toBeGreaterThanOrEqual(5);
  });

  it("losing ends the game and nothing moves after that", () => {
    const s = act({ ...slimeFight(), hp: 1 }, { type: "guard" });
    expect(s.mode).toBe("lost");
    expect(s.hp).toBe(0);
    expect(play(s, mv("down"), { type: "potion" }, { type: "attack" })).toEqual(s);
  });

  it("beating Mallakoth wins the game", () => {
    const boss = act(put(at(5, 5), enemy("mallakoth", 6, 5)), mv("right"));
    const s = act({ ...boss, crystals: 1, battle: { ...boss.battle!, hp: 1 } }, { type: "crystal" });
    expect(s.mode).toBe("won");
    expect(play(s, mv("down"))).toEqual(s);
  });
});

describe("the game as data", () => {
  it("is the same game for the same seed", () => {
    const run = (seed: number) => play(put(at(5, 5, { rng: seed }), enemy("golem", 6, 5)), mv("right"), { type: "attack" }, { type: "attack" });
    expect(run(7)).toEqual(run(7));
    expect(run(7).rng).not.toBe(run(8).rng);
  });

  it("survives a trip through JSON, which is how it's saved", () => {
    const s = play(put(at(5, 5), enemy("golem", 6, 5)), mv("right"), { type: "attack" });
    const back = JSON.parse(JSON.stringify(s));
    expect(isState(back)).toBe(true);
    expect(back).toEqual(s);
    expect(act(back, { type: "attack" })).toEqual(act(s, { type: "attack" }));
  });

  it("refuses things that aren't saved games", () => {
    expect(isState(null)).toBe(false);
    expect(isState("hi")).toBe(false);
    expect(isState({})).toBe(false);
    expect(isState({ ...newGame(1), mode: "dancing" })).toBe(false);
    expect(isState({ ...newGame(1), entities: undefined })).toBe(false);
    expect(isState(newGame(1))).toBe(true);
  });
});

describe("a whole game", () => {
  it("can be won by walking the map in order and fighting sensibly, whatever the dice say", () => {
    const results = Array.from({ length: 60 }, (_, i) => playThrough(i + 1));
    const lost = results.filter((r) => r.mode !== "won").length;
    expect(lost).toBe(0);
  });

  it("is won with the sword, a few levels and some potions to spare", () => {
    const s = playThrough(3);
    expect(s.mode).toBe("won");
    expect(s.sword).toBe(true);
    expect(s.level).toBeGreaterThanOrEqual(3);
  });

  it("can be lost: rushing the boss with nothing is a death sentence", () => {
    let s = newGame(5);
    s = { ...s, keys: 1, pos: { x: 8, y: 5 } };
    for (let i = 0; i < 400 && s.mode !== "lost" && s.mode !== "won"; i++) {
      if (s.mode === "battle") s = act(s, { type: "attack" });
      else if (s.mode === "dialogue") s = act(s, { type: "next" });
      else {
        const boss = s.entities.find((e) => e.what === "mallakoth" || e.what === "keeper") ?? s.entities.find((e) => e.kind === "gate");
        const d = boss && stepToward(s, boss);
        s = act(s, mv(d ?? "down"));
      }
    }
    expect(s.mode).toBe("lost");
  });
});

describe("the Dwarf's shop", () => {
  it("sells potions once you have the sword, for coins, one at a time", () => {
    const first = act(at(2, 4, { sword: true, gold: POTION_PRICE * 2 + 1 }), mv("down"));
    expect(first.potions).toBe(1);
    expect(first.gold).toBe(POTION_PRICE + 1);
    const second = act(play(first, { type: "next" }), mv("down"));
    expect(second.potions).toBe(2);
    expect(second.gold).toBe(1);
    const broke = act(play(second, { type: "next" }), mv("down"));
    expect(broke.potions).toBe(2);
    expect(broke.gold).toBe(1);
  });
});
