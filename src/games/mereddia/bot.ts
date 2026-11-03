import { POTION_PRICE, act, entityAt, groundAt, maxHp, newGame, type Action, type Dir, type State } from "./engine";
import { ENEMIES, type Entity } from "./world";

// A bot that plays the whole game: it walks the map, fights with a sensible policy, and has to win.

const mv = (dir: Dir): Action => ({ type: "move", dir });
const DIRS: Dir[] = ["up", "down", "left", "right"];
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// The first move along a shortest path from the hero to a tile next to `target`, around everything standing.
export function stepToward(s: State, target: Entity): Dir | undefined {
  const free = (x: number, y: number) => groundAt(x, y) === "." && !entityAt(s, x, y);
  const first = new Map<string, Dir | undefined>([[`${s.pos.x},${s.pos.y}`, undefined]]);
  const queue = [s.pos];
  while (queue.length) {
    const p = queue.shift()!;
    for (const d of DIRS) {
      const x = p.x + DELTA[d][0];
      const y = p.y + DELTA[d][1];
      if (x === target.x && y === target.y) return first.get(`${p.x},${p.y}`) ?? d;
      if (!free(x, y) || first.has(`${x},${y}`)) continue;
      first.set(`${x},${y}`, first.get(`${p.x},${p.y}`) ?? d);
      queue.push({ x, y });
    }
  }
  return undefined;
}

function battleMove(s: State): Action {
  const foe = ENEMIES[s.battle!.kind];
  if (s.hp < maxHp(s.level) * 0.4 && s.potions > 0) return { type: "potion" };
  if (foe.boss && s.crystals > 0) return { type: "crystal" };
  return { type: "attack" };
}

type Step = { want: string; until?: (s: State) => boolean };

// Talking and shopping never "finish" on their own, so those steps say when they're done.
const ROUTE: Step[] = [
  { want: "npc:vastios", until: (s) => !!s.flags.vastios },
  { want: "enemy:slime" },
  { want: "enemy:slime" },
  { want: "enemy:slime" },
  { want: "npc:dwarf", until: (s) => s.sword },
  { want: "chest:crystals" },
  { want: "enemy:golem" },
  { want: "chest:key" },
  { want: "npc:dwarf", until: (s) => s.gold < POTION_PRICE },
  { want: "gate" },
  { want: "enemy:keeper" },
  { want: "chest:last" },
  { want: "enemy:mallakoth" },
];

export function playThrough(seed: number): State {
  let s = newGame(seed);
  for (const { want, until } of ROUTE) {
    const [kind, what] = want.split(":");
    const over = (t: State) => t.mode === "lost" || t.mode === "won";
    for (let guard = 0; guard < 400 && !over(s); guard++) {
      const target = s.entities.find((e) => e.kind === kind && (what === undefined || e.what === what) && !e.done);
      if (!target || (until?.(s) && s.mode === "explore")) break;
      if (s.mode === "battle") s = act(s, battleMove(s));
      else if (s.mode === "dialogue") s = act(s, { type: "next" });
      else {
        const d = stepToward(s, target);
        if (!d) break;
        s = act(s, mv(d));
      }
    }
  }
  return s;
}
