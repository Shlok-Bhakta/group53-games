import { describe, expect, it } from "vitest";
import { cuesFor } from "./cues";
import { act, maxHp, newGame, type Action, type Dir, type State } from "./engine";
import type { Entity } from "./world";

const mv = (dir: Dir): Action => ({ type: "move", dir });
const at = (x: number, y: number, extra: Partial<State> = {}): State => ({ ...newGame(1), pos: { x, y }, ...extra });
const names = (a: State, b: State) => cuesFor(a, b).map((c) => c.name);
const foe = (kind: string, x: number, y: number): Entity => ({ id: `enemy:t${x}`, kind: "enemy", what: kind, x, y });

describe("sound cues", () => {
  it("are silent for plain walking", () => {
    const s = at(1, 3);
    expect(names(s, act(s, mv("down")))).toEqual([]);
  });

  it("hit, then hurt a moment later, in a fight that goes on", () => {
    const start = act({ ...at(5, 5), entities: [foe("golem", 6, 5)] }, mv("right"));
    const cues = cuesFor(start, act(start, { type: "attack" }));
    expect(cues.map((c) => c.name)).toEqual(["attack", "hurt"]);
    expect(cues[1].delay).toBeGreaterThan(cues[0].delay);
  });

  it("defeat and level-up land after the blow", () => {
    const start = act({ ...at(5, 5), entities: [foe("slime", 6, 5)], crystals: 1, xp: 7 }, mv("right"));
    const cues = cuesFor(start, act(start, { type: "crystal" }));
    expect(cues.map((c) => c.name)).toEqual(["attack", "defeat", "level"]);
    expect(cues.map((c) => c.delay)).toEqual([...cues.map((c) => c.delay)].sort((a, b) => a - b));
  });

  it("heal for a potion, chest for a chest, gate for the gate", () => {
    const hurt = at(1, 1, { potions: 1, hp: maxHp(1) - 5 });
    expect(names(hurt, act(hurt, { type: "potion" }))).toEqual(["heal"]);
    const chest = at(14, 4);
    expect(names(chest, act(chest, mv("down")))).toEqual(["chest"]);
    const gate = at(8, 5, { keys: 1 });
    expect(names(gate, act(gate, mv("down")))).toEqual(["gate"]);
  });

  it("pick up what an NPC hands over", () => {
    const s = at(4, 2);
    expect(names(s, act(s, mv("up")))).toEqual(["pickup"]);
  });

  it("make no sound for a bump that does nothing", () => {
    const s = at(8, 5);
    expect(names(s, act(s, mv("down")))).toEqual([]);
  });
});
