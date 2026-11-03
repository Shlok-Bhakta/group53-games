import type { State } from "./engine";

// Which of the project's sound effects to play for what just happened, worked out by comparing the
// state before an action with the state after it. Pure, so it can be tested without any audio.

export type CueName = "attack" | "hurt" | "defeat" | "chest" | "heal" | "pickup" | "level" | "gate";
export type Cue = { name: CueName; delay: number };

const count = (s: State, kind: string) => s.entities.filter((e) => e.kind === kind).length;
const opened = (s: State) => s.entities.filter((e) => e.kind === "chest" && e.done).length;

export function cuesFor(prev: State, next: State): Cue[] {
  const cues: Cue[] = [];
  const beaten = count(next, "enemy") < count(prev, "enemy");
  const struck = (prev.battle && next.battle && next.battle.hp < prev.battle.hp) || beaten;
  if (struck) cues.push({ name: "attack", delay: 0 });
  if (beaten) cues.push({ name: "defeat", delay: 180 });
  if (next.hp < prev.hp) cues.push({ name: "hurt", delay: struck ? 320 : 0 });
  if (next.level > prev.level) cues.push({ name: "level", delay: 450 });
  else if (next.hp > prev.hp) cues.push({ name: "heal", delay: 0 });
  if (count(next, "gate") < count(prev, "gate")) cues.push({ name: "gate", delay: 0 });
  if (opened(next) > opened(prev)) cues.push({ name: "chest", delay: 0 });
  else if (next.potions > prev.potions || next.crystals > prev.crystals || (next.sword && !prev.sword)) cues.push({ name: "pickup", delay: 0 });
  return cues;
}
