import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { cuesFor, loopsFor } from "./cues";
import { act, maxHp, newGame, type Action, type Dir, type State } from "./engine";
import type { AreaId, Entity } from "./world";

const mv = (dir: Dir): Action => ({ type: "move", dir });
const at = (area: AreaId, x: number, y: number, extra: Partial<State> = {}): State => ({ ...newGame(1), mode: "explore", dlg: undefined, area, pos: { x, y }, ...extra });
const names = (a: State, b: State) => cuesFor(a, b).map((c) => c.name);
const foe = (s: State, kind: string, x: number, y: number): State => ({ ...s, entities: [...s.entities, { id: `t:${x}`, area: s.area, kind: "enemy", what: kind, x, y } as Entity] });
const first = (area: AreaId, pred: (e: Entity) => boolean) => at(area, 0, 0).entities.find((e) => e.area === area && pred(e))!;

describe("sound cues", () => {
  it("only ever ask for sounds that exist in the project's sound folder", () => {
    // Every name a cue can carry, found by playing the kinds of moves that make them.
    const asked = new Set<string>();
    const note = (a: State, b: State) => cuesFor(a, b).forEach((c) => asked.add(c.name));
    const hurt = at("field", 3, 3, { potions: 1, hp: maxHp(1) - 8 });
    note(hurt, act(hurt, { type: "potion" }));
    const fight = act(foe(at("slimes", 5, 5, { xp: 11 }), "green", 6, 5), mv("right"));
    note(at("slimes", 5, 5), fight);
    for (const a of ["attack", "guard", "dodge", "spell", "potion"] as const) note(fight, act(fight, { type: a }));
    const hit = { ...fight, battle: { ...fight.battle!, hp: 1 } };
    note(hit, act(hit, { type: "attack" }));
    const gate = at("caves", 0, 0).entities.find((e) => e.kind === "gate")!;
    const g = at("caves", gate.x, gate.y + 1, { keys: 1 });
    note(g, act(g, mv("up")));
    for (const n of ["Letter", "Letter_Burn", "pigeon_flap", "AwakenGolem", "Golem_Awaken", "Altar_slide", "Note-interact", "Ricky_Spawn", "Boulder_Roll", "Waterfall", "water_noises", "Poison", "success_plate", "pressure_plate_down", "Stone_Wall_Close", "Slime_Idle", "Slime_Walk", "Slime_Boss_Idle", "Slime_Boss_Walk", "footsteps", "lever_pull", "button_press", "Book_Open", "Sacred_Flame", "axe", "pick_attack", "pickaxe_fixed", "Door_Interact", "Magic_Crystal", "Normal_Fire", "death_enemy2"]) asked.add(n);
    for (const name of asked) expect(fs.existsSync(`public/mereddia/audio/sfx/${name}.mp3`), name).toBe(true);
    for (const track of ["Forest_with_leaves_woodpecker_LONG", "cave_ambiance", "GolemTheme"]) expect(fs.existsSync(`public/mereddia/audio/music/${track}.mp3`), track).toBe(true);
  });

  it("make footsteps for walking, and nothing for standing still", () => {
    const s = at("field", 3, 3, { steps: 1 });
    const moved = act(s, mv("down"));
    expect(names(s, moved)).toEqual(["footsteps"]);
    expect(names(s, s)).toEqual([]);
  });

  it("sound a swing, the enemy being hit and the slime's lunge in a fight that goes on", () => {
    const start = act(foe(at("slimes", 5, 5), "orange", 6, 5), mv("right"));
    const cues = names(start, act({ ...start, battle: { ...start.battle!, intent: "strike" } }, { type: "attack" }));
    expect(cues).toContain("Sword_Attack");
    expect(cues).toContain("enemy_hit");
    expect(cues.some((c) => c === "Slime_Walk" || c === "Hit_Player")).toBe(true);
  });

  it("start a fight with the slime's own noise", () => {
    expect(names(at("slimes", 5, 5), act(foe(at("slimes", 5, 5), "red", 6, 5), mv("right")))).toContain("Slime_Idle");
  });

  it("death, then the level-up, land after the blow", () => {
    const start = act(foe(at("slimes", 5, 5, { xp: 11 }), "green", 6, 5), mv("right"));
    const hit = { ...start, battle: { ...start.battle!, hp: 1, intent: "strike" as const } };
    const cues = cuesFor(hit, act(hit, { type: "attack" }));
    const order = cues.map((c) => c.name);
    expect(order).toContain("Sword_Attack");
    expect(order.some((n) => n.startsWith("death_enemy"))).toBe(true);
    expect(order).toContain("level_up");
    expect(cues.find((c) => c.name === "level_up")!.delay).toBeGreaterThan(cues.find((c) => c.name === "Sword_Attack")!.delay);
  });

  it("heal for a potion, and break a pot with a crash", () => {
    const hurt = at("field", 3, 3, { potions: 1, hp: maxHp(1) - 8 });
    expect(names(hurt, act(hurt, { type: "potion" }))).toEqual(["heal"]);
    const p = first("caves", (e) => e.kind === "pot");
    const pot = at("caves", p.x, p.y + 1);
    expect(names({ ...pot, facing: "up" }, act({ ...pot, facing: "up" }, { type: "swing" }))).toContain("clay_pottery_break");
  });

  it("unlock the gate with a key, and slide a panel with stone", () => {
    const g = first("caves", (e) => e.kind === "gate");
    const gate = at("caves", g.x, g.y + 1, { keys: 1 });
    const asked = act(gate, mv("up"));
    expect(names(asked, act(asked, { type: "choose", i: 0 }))).toContain("Open_Key");
    const b = first("temple", (e) => e.what === "L1");
    const button = at("temple", b.x + 1, b.y);
    expect(names(button, act(button, mv("left")))).toEqual(expect.arrayContaining(["button_press", "Stone_Wall_Open"]));
  });

  it("pick up the pickaxe with its own sound", () => {
    const p = first("caves", (e) => e.what === "pickrock");
    const s = at("caves", p.x - 1, p.y);
    const asked = act(s, mv("right"));
    expect(names(asked, act(asked, { type: "choose", i: 0 }))).toContain("pickaxe_fixed");
  });

  it("click and poison for a wrong plate, and a success chime for a right one", () => {
    const plate = (col: number, row: number) => first("caves", (e) => e.what === `p:${col}:${row}`);
    const right = plate(0, 2);
    const s = at("caves", right.x + 1, right.y);
    expect(names(s, act(s, mv("left")))).toEqual(expect.arrayContaining(["pressure_plate_down", "success_plate"]));
    const wrong = plate(0, 1);
    const w = at("caves", wrong.x + 1, wrong.y);
    expect(names(w, act(w, mv("left")))).toContain("Poison");
  });

  it("let the boulder roll, and let the waterfall be heard only near the falls", () => {
    expect(loopsFor({ ...at("caves", 7, 24), boulder: { pos: 1 } } as State).map((l) => l.name)).toContain("Boulder_Roll");
    const near = loopsFor(at("temple", 33, 8)).find((l) => l.id === "waterfall")!;
    const far = loopsFor(at("temple", 16, 30)).find((l) => l.id === "waterfall")!;
    expect(near.volume).toBeGreaterThan(far.volume);
    expect(loopsFor(at("caves", 40, 40))).toEqual([]);
  });
});
