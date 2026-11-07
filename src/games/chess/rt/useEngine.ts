import { useCallback, useRef } from "react";
import { initialState, simulate, type Command, type Pace, type State, type Variant } from "../../../../convex/chess/realtime";

// Replays from the server's settled snapshot, continuing from the last frame when nothing earlier changed.
export function useEngine(snapshot: State | null, commands: Command[], variant: Variant, pace: Pace) {
  const cache = useRef<{ base: State | null; commands: Command[]; state: State } | null>(null);
  return useCallback(
    (toTick: number): State => {
      const base = snapshot ?? null;
      const c = cache.current;
      const prefixOk =
        c &&
        c.base === base &&
        c.commands.length <= commands.length &&
        c.commands.every((x, i) => x === commands[i] || (x.tick === commands[i].tick && x.pieceId === commands[i].pieceId && x.toX === commands[i].toX && x.toY === commands[i].toY && x.kind === commands[i].kind));
      const fresh = commands.slice(c?.commands.length ?? 0);
      const resume = c && prefixOk && fresh.every((x) => x.tick >= c.state.tick) && c.state.tick <= toTick;
      const state = resume ? simulate(commands, toTick, c!.state) : simulate(commands, toTick, base ?? initialState(variant, pace));
      cache.current = { base, commands, state };
      return state;
    },
    [snapshot, commands, variant, pace],
  );
}

// Everything that changes the board's structure (not just positions). React only re-renders when this does.
export const structureOf = (s: State) =>
  JSON.stringify([
    s.pieces.map((p) => [p.id, p.kind, p.status, p.x, p.y, p.toX, p.toY, p.pending?.toX, p.pending?.toY, p.dead]),
    s.out,
    s.result,
    s.captures.length,
  ]);
