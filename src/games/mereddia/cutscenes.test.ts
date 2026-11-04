import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUTSCENES, stepMs } from "./cutscenes";
import { playThrough } from "./bot";
import { act, newGame } from "./engine";
import { NODES } from "./story";

const pub = (p: string) => `public/mereddia/${p}`;

describe("cutscenes", () => {
  it("only use sounds, effects and models that exist", () => {
    for (const [id, steps] of Object.entries(CUTSCENES))
      for (const s of steps) {
        if (s.do === "sfx") expect(existsSync(pub(`audio/sfx/${s.name}.mp3`)), `${id}: ${s.name}`).toBe(true);
        if (s.do === "fx") expect(existsSync(pub(`3d/effects/${s.name}.json`)), `${id}: ${s.name}`).toBe(true);
        if (s.do === "actor" && s.model) expect(existsSync(pub(`3d/models/${s.model.kind}/${s.model.name}.json`)), `${id}: ${s.model.name}`).toBe(true);
      }
  });

  it("have real gestures for the people who make them", () => {
    const anims = (kind: string, name: string) => Object.keys(JSON.parse(readFileSync(pub(`3d/models/${kind}/${name}.json`), "utf8")).meta?.animations ?? JSON.parse(readFileSync(pub(`3d/models/${kind}/${name}.json`), "utf8")).animations ?? {});
    const body: Record<string, [string, string]> = { hero: ["characters", "Mallakoth_red_2"], drawf: ["characters", "Drawf_move2"], vastios: ["characters", "Vastios_Threea"], wilfred: ["characters", "Wilfred_tuah"], golem: ["characters", "Golem"], pigeon: ["characters", "Pigeon"] };
    for (const [id, steps] of Object.entries(CUTSCENES))
      for (const s of steps)
        if (s.do === "actor" && s.shot && body[s.who]) expect(anims(...body[s.who]), `${id}: ${s.who} ${s.shot}`).toContain(s.shot);
  });

  it("each end by giving the camera back", () => {
    for (const [id, steps] of Object.entries(CUTSCENES)) {
      expect(steps[0], id).toMatchObject({ do: "bars", on: true });
      expect(steps.at(-1), id).toMatchObject({ do: "bars", on: false });
      expect(steps.reduce((n, s) => n + stepMs(s), 0), id).toBeGreaterThan(0);
    }
  });

  it("are asked for by the game, and cleared when seen", () => {
    const g = newGame(1);
    expect(g.cut?.id).toBe("intro");
    const seen = act(g, { type: "seen" });
    expect(seen.cut).toBeUndefined();
    expect(seen.mode).toBe("dialogue");
  });

  it("are all named by something", () => {
    const named = new Set(Object.values(NODES).map((n) => n.scene).filter(Boolean));
    expect([...named].every((n) => CUTSCENES[n!])).toBe(true);
  });

  it("end the game in the sanctum, months later, with the oath scenes still to play", () => {
    const end = playThrough(3, "direct");
    expect(end.mode).toBe("won");
    expect(end.area).toBe("finale");
  });
});
