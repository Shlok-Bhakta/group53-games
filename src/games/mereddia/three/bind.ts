import type { Entity, Dir } from "../world";
import { TILE, type Desired } from "./stage";

// Which of the project's models stands for each thing in the game rules, and where it stands in 3D.

type Ref = { kind: "characters" | "objects"; name: string };

const NPC: Record<string, string> = { vastios: "Vastios", wilfred: "Wilfred", drawf: "Drawf_Dialogue", master: "Secret Master", stefan: "Steven", clavicus: "Clavicus", joshua: "Joshua" };

// Only things that move or change on their own are drawn by the game rules: people and enemies. Fixed
// props (trees, doors, statues) are the map's own scenery and are hidden only when the rules remove them.
export function modelFor(e: Entity): Ref | null {
  switch (e.kind) {
    case "enemy":
      if (e.what === "golem") return { kind: "characters", name: "Golem" };
      return { kind: "characters", name: e.what === "bigslime" ? "Boss_slime" : `${e.what}_slime` };
    case "npc":
      return NPC[e.what] ? { kind: "characters", name: NPC[e.what] } : null;
    default:
      return null;
  }
}

// Facing: the project's models face south (towards +z) at rest.
export const ROT: Record<Dir, number> = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };

// A grid cell's centre in the world, given where the map's own origin sits.
export const world = (x: number, y: number, x0: number, y0: number) => ({ x: (x + x0) * TILE + TILE / 2, z: (y + y0) * TILE + TILE / 2 });

export const CHARACTER_SCALE = 0.85;

export function desired(entities: Entity[], x0: number, y0: number): Desired[] {
  const out: Desired[] = [];
  for (const e of entities) {
    const m = modelFor(e);
    if (!m) continue;
    const w = world(e.x, e.y, x0, y0);
    out.push({ key: e.id, ...m, ...w, rotY: e.kind === "npc" || e.kind === "enemy" ? 0 : Math.PI, scale: m.kind === "characters" ? CHARACTER_SCALE : 1 });
  }
  return out;
}
