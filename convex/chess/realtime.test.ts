import { describe, expect, test } from "vitest";
import {
  COOLDOWN_TICKS,
  NO_PROGRESS_TICKS,
  TICKS_PER_SQUARE,
  initialState,
  legalTargets,
  positionAt,
  predictEnd,
  premoveTargets,
  simulate,
  type Command,
  type Piece,
  type State,
} from "./realtime";

// Square names to coordinates: "e2" -> [4, 1].
const sq = (s: string): [number, number] => [s.charCodeAt(0) - 97, Number(s[1]) - 1];
const at = (state: State, s: string) => {
  const [x, y] = sq(s);
  return state.pieces.find((p) => p.status !== "moving" && p.x === x && p.y === y);
};
const pieceOn = (s: string, state = initialState()) => at(state, s)!;
const move = (tick: number, from: string, to: string, state = initialState()): Command => {
  const p = pieceOn(from, state);
  const [toX, toY] = sq(to);
  return { tick, color: p.color, pieceId: p.id, toX, toY };
};
const targets = (state: State, from: string) =>
  legalTargets(state.pieces, at(state, from)!).map(([x, y]) => String.fromCharCode(97 + x) + (y + 1)).sort();

// A custom position: pieces given as "wKe1" style strings, all ready.
function position(...specs: string[]): State {
  const pieces: Piece[] = specs.map((s, id) => {
    const [x, y] = sq(s.slice(2));
    return { id, color: s[0] as "w" | "b", kind: s[1] as Piece["kind"], x, y, firstMove: false, status: "ready" };
  });
  return { ...initialState(), pieces };
}
const run = (commands: Command[], toTick: number, from: State) => simulate(commands, toTick, from);

describe("movement", () => {
  test("pieces travel one square per second and then cool down for five seconds", () => {
    const cmd = move(0, "e2", "e4");
    const id = cmd.pieceId;
    const mid = simulate([cmd], 30);
    expect(mid.pieces.find((p) => p.id === id)).toMatchObject({ status: "moving", toX: 4, toY: 3 });
    const landed = simulate([cmd], 2 * TICKS_PER_SQUARE + 1);
    expect(landed.pieces.find((p) => p.id === id)).toMatchObject({ status: "cooldown", x: 4, y: 3, readyAt: 60 + COOLDOWN_TICKS });
    const ready = simulate([cmd], 60 + COOLDOWN_TICKS + 1);
    expect(ready.pieces.find((p) => p.id === id)?.status).toBe("ready");
  });

  test("diagonals cost the same as straight lines", () => {
    const s = simulate([move(0, "e2", "e3")], 31);
    const bishop = move(31, "f1", "c4", s);
    const later = simulate([move(0, "e2", "e3"), bishop], 31 + 3 * TICKS_PER_SQUARE + 1);
    expect(later.pieces.find((p) => p.id === bishop.pieceId)).toMatchObject({ status: "cooldown", x: 2, y: 3 });
  });

  test("knights take two seconds", () => {
    const cmd = move(0, "g1", "f3");
    expect(simulate([cmd], 60).pieces.find((p) => p.id === cmd.pieceId)?.status).toBe("moving");
    expect(simulate([cmd], 61).pieces.find((p) => p.id === cmd.pieceId)?.status).toBe("cooldown");
  });

  test("a moving piece's position is interpolated", () => {
    const cmd = move(0, "a2", "a4");
    const p = simulate([cmd], 15).pieces.find((x) => x.id === cmd.pieceId)!;
    expect(positionAt(p, 30)).toEqual({ x: 0, y: 2 * 120 });
  });

  test("a piece can't move again while it travels or cools down", () => {
    const first = move(0, "e2", "e3");
    const again = { ...first, tick: 40, toY: 3 };
    const s = simulate([first, again], 200);
    expect(s.pieces.find((p) => p.id === first.pieceId)).toMatchObject({ x: 4, y: 2 });
  });

  test("illegal commands are ignored", () => {
    const s = simulate([move(0, "e2", "e5")], 200);
    expect(at(s, "e2")?.kind).toBe("P");
  });

  test("both players can move on the same tick", () => {
    const s = simulate([move(0, "e2", "e4"), move(0, "e7", "e5")], 61);
    expect(at(s, "e4")?.color).toBe("w");
    expect(at(s, "e5")?.color).toBe("b");
  });
});

describe("legal moves", () => {
  test("only resting pieces block; enemy pieces in motion don't", () => {
    const s = position("wRa1", "bNa4", "wKh1", "bKh8");
    expect(targets(s, "a1")).toEqual(["a2", "a3", "a4", "b1", "c1", "d1", "e1", "f1", "g1"]);
    const flying = simulate([{ tick: 0, color: "b", pieceId: 1, toX: 2, toY: 4 }], 5, s);
    expect(targets(flying, "a1")).toContain("a8");
  });

  test("you can't target a square your own piece is heading to", () => {
    const s = position("wRa1", "wRh2", "wKe1", "bKe8");
    const heading = simulate([{ tick: 0, color: "w", pieceId: 1, toX: 0, toY: 1 }], 1, s);
    expect(targets(heading, "a1")).not.toContain("a2");
    expect(targets(heading, "a1")).not.toContain("a3");
  });

  test("pawns push into empty squares and capture only resting enemies diagonally", () => {
    const s = position("wPe4", "bPd5", "bPe5", "wKa1", "bKh8");
    expect(targets(s, "e4")).toEqual(["d5"]);
  });

  test("there is no check: a king may walk into attack", () => {
    const s = position("wKe1", "bRd8", "bKh8");
    expect(targets(s, "e1")).toContain("d1");
  });

  test("castling needs an unmoved king and rook and a clear path", () => {
    const s = initialState();
    expect(targets(s, "e1")).toEqual([]);
    const cleared = position("wKe1", "wRa1", "wRh1", "bKe8");
    cleared.pieces = cleared.pieces.map((p) => ({ ...p, firstMove: true }));
    expect(targets(cleared, "e1")).toEqual(["c1", "d1", "d2", "e2", "f1", "f2", "g1"]);
  });
});

describe("castling", () => {
  test("king and rook land together", () => {
    const s = position("wKe1", "wRh1", "bKe8");
    s.pieces = s.pieces.map((p) => ({ ...p, firstMove: true }));
    const kingside = simulate([{ tick: 0, color: "w", pieceId: 0, toX: 6, toY: 0 }], 61, s);
    expect(at(kingside, "g1")?.kind).toBe("K");
    expect(at(kingside, "f1")?.kind).toBe("R");
  });

  test("queenside takes three seconds for both", () => {
    const s = position("wKe1", "wRa1", "bKe8");
    s.pieces = s.pieces.map((p) => ({ ...p, firstMove: true }));
    const cmd: Command = { tick: 0, color: "w", pieceId: 0, toX: 2, toY: 0 };
    expect(at(simulate([cmd], 90, s), "c1")).toBeUndefined();
    const done = simulate([cmd], 91, s);
    expect(at(done, "c1")?.kind).toBe("K");
    expect(at(done, "d1")?.kind).toBe("R");
  });
});

describe("captures", () => {
  test("a moving piece captures a resting one", () => {
    const s = position("wRa1", "bNa5", "wKh1", "bKh8");
    const after = simulate([{ tick: 0, color: "w", pieceId: 0, toX: 0, toY: 4 }], 121, s);
    expect(at(after, "a5")).toMatchObject({ kind: "R", color: "w" });
    expect(after.captures).toHaveLength(1);
  });

  test("a piece that wanders into a moving piece's path gets taken", () => {
    // The rook starts toward a8; the black knight lands on a6 after the rook set off.
    const s = position("wRa1", "bNb8", "wKh1", "bKh8");
    const cmds: Command[] = [
      { tick: 0, color: "w", pieceId: 0, toX: 0, toY: 7 },
      { tick: 0, color: "b", pieceId: 1, toX: 0, toY: 5 },
    ];
    const after = simulate(cmds, 7 * TICKS_PER_SQUARE + 1, s);
    expect(after.pieces.find((p) => p.id === 1)).toBeUndefined();
    expect(at(after, "a8")).toMatchObject({ kind: "R" });
  });

  test("when both are moving, the one that started first wins", () => {
    const s = position("wRa1", "bRa8", "wKh1", "bKh2");
    const cmds: Command[] = [
      { tick: 0, color: "w", pieceId: 0, toX: 0, toY: 7 },
      { tick: 10, color: "b", pieceId: 1, toX: 0, toY: 0 },
    ];
    const after = simulate(cmds, 300, s);
    expect(after.pieces.map((p) => p.id).sort()).toEqual([0, 2, 3]);
  });

  test("simultaneous starts trade both pieces", () => {
    const s = position("wRa1", "bRa8", "wKh1", "bKh2");
    const cmds: Command[] = [
      { tick: 0, color: "w", pieceId: 0, toX: 0, toY: 7 },
      { tick: 0, color: "b", pieceId: 1, toX: 0, toY: 0 },
    ];
    const after = simulate(cmds, 300, s);
    expect(after.pieces.map((p) => p.id).sort()).toEqual([2, 3]);
  });

  test("knights jump over pieces they pass", () => {
    const s = position("wNb1", "bPb2", "bPc2", "wKh1", "bKh8");
    const after = simulate([{ tick: 0, color: "w", pieceId: 0, toX: 2, toY: 2 }], 61, s);
    expect(after.captures).toEqual([]);
    expect(at(after, "c3")?.kind).toBe("N");
  });

  test("pieces of the same color pass through each other", () => {
    const s = position("wRa1", "wNb3", "wKh1", "bKh8");
    const cmds: Command[] = [
      { tick: 0, color: "w", pieceId: 0, toX: 0, toY: 5 },
      { tick: 0, color: "w", pieceId: 1, toX: 0, toY: 1 },
    ];
    expect(simulate(cmds, 200, s).captures).toEqual([]);
  });
});

describe("promotion and endings", () => {
  test("pawns promote to a queen when they land on the last rank", () => {
    const s = position("wPa7", "wKh1", "bKh8");
    const after = simulate([{ tick: 0, color: "w", pieceId: 0, toX: 0, toY: 7 }], 31, s);
    expect(at(after, "a8")?.kind).toBe("Q");
  });

  test("capturing the king wins", () => {
    const s = position("wQd1", "bKd8", "wKh1");
    const after = simulate([{ tick: 0, color: "w", pieceId: 0, toX: 3, toY: 7 }], 1000, s);
    expect(after.result).toEqual({ winner: "w", reason: "king", ranking: [["w"], ["b"]] });
    expect(after.endTick).toBeLessThan(7 * TICKS_PER_SQUARE);
  });

  test("both kings falling on the same tick is a draw", () => {
    // Each rook runs the full length of its own file into the enemy king, in lockstep.
    const s = position("wKa1", "bKh8", "wRh1", "bRa8");
    const cmds: Command[] = [
      { tick: 0, color: "w", pieceId: 2, toX: 7, toY: 7 },
      { tick: 0, color: "b", pieceId: 3, toX: 0, toY: 0 },
    ];
    expect(simulate(cmds, 1000, s).result).toEqual({ winner: null, reason: "both_kings", ranking: [["w", "b"]] });
  });

  test("ninety seconds without a capture or pawn move is a draw", () => {
    const s = simulate([], NO_PROGRESS_TICKS + 1);
    expect(s.result).toEqual({ winner: null, reason: "no_progress", ranking: [["w", "b"]] });
    expect(s.endTick).toBe(NO_PROGRESS_TICKS);
  });

  test("a pawn move resets the no-progress clock", () => {
    const s = simulate([move(1000, "e2", "e3")], NO_PROGRESS_TICKS + 1);
    expect(s.result).toBeNull();
  });

  test("nothing moves after the game is over", () => {
    const s = position("wQd1", "bKd8", "wKh1", "bRa8");
    const cmds: Command[] = [
      { tick: 0, color: "w", pieceId: 0, toX: 3, toY: 7 },
      { tick: 400, color: "b", pieceId: 3, toX: 0, toY: 0 },
    ];
    const after = simulate(cmds, 2000, s);
    expect(after.pieces.find((p) => p.id === 3)).toMatchObject({ x: 0, y: 7 });
  });

  test("predictEnd finds when a game will finish if nobody moves again", () => {
    expect(predictEnd([], 0)).toEqual({ tick: NO_PROGRESS_TICKS, result: { winner: null, reason: "no_progress", ranking: [["w", "b"]] } });
    // A pawn move at tick 1000 pushes the no-progress draw back by that much.
    expect(predictEnd([move(1000, "e2", "e3")], 0).tick).toBe(1000 + NO_PROGRESS_TICKS);
    expect(predictEnd([move(1000, "e2", "e3")], 2000).tick).toBe(1000 + NO_PROGRESS_TICKS);
  });
});

describe("premoves", () => {
  test("a premove queued during cooldown fires the tick the piece is ready", () => {
    const first = move(0, "e2", "e3");
    const pre: Command = { ...first, tick: 40, toY: 3 };
    // Lands at tick 30, ready at 30 + 150 = 180, then moves to e4 (lands 30 ticks later).
    const before = simulate([first, pre], 180);
    expect(before.pieces.find((p) => p.id === first.pieceId)).toMatchObject({ status: "cooldown", pending: { toX: 4, toY: 3 } });
    const fired = simulate([first, pre], 181);
    expect(fired.pieces.find((p) => p.id === first.pieceId)).toMatchObject({ status: "moving", startTick: 180, toY: 3 });
    expect(fired.pieces.find((p) => p.id === first.pieceId)?.pending).toBeUndefined();
  });

  test("a premove made while moving is measured from where the piece lands", () => {
    const s = position("wRa1", "wKh1", "bKh8");
    const cmds: Command[] = [
      { tick: 0, color: "w", pieceId: 0, toX: 0, toY: 3 },
      { tick: 10, color: "w", pieceId: 0, toX: 5, toY: 3 },
    ];
    const queued = simulate(cmds, 20, s);
    expect(queued.pieces[0].pending).toEqual({ toX: 5, toY: 3 });
  });

  test("a new premove replaces the old one, and cancel drops it", () => {
    const first = move(0, "e2", "e3");
    const a: Command = { ...first, tick: 40, toY: 3 };
    const b: Command = { ...first, tick: 50, toX: 4, toY: 3 };
    const cancel: Command = { ...first, tick: 60, kind: "cancel" };
    expect(simulate([first, a, b], 100).pieces.find((p) => p.id === first.pieceId)?.pending).toEqual({ toX: 4, toY: 3 });
    const cancelled = simulate([first, a, cancel], 400);
    expect(cancelled.pieces.find((p) => p.id === first.pieceId)).toMatchObject({ status: "ready", x: 4, y: 2 });
  });

  test("a premove that's no longer legal when it fires is dropped", () => {
    // The rook premoves to a5, but a white knight parks there first.
    const s = position("wRa1", "wNb3", "wKh1", "bKh8");
    const cmds: Command[] = [
      { tick: 0, color: "w", pieceId: 0, toX: 0, toY: 1 },
      { tick: 5, color: "w", pieceId: 0, toX: 0, toY: 4 },
      { tick: 0, color: "w", pieceId: 1, toX: 0, toY: 4 },
    ];
    const after = simulate(cmds, 400, s);
    expect(after.pieces.find((p) => p.id === 0)).toMatchObject({ x: 0, y: 1, status: "ready" });
    expect(after.pieces.find((p) => p.id === 0)?.pending).toBeUndefined();
  });

  test("premove targets follow the piece's shape and ignore blockers", () => {
    const s = simulate([move(0, "g1", "f3")], 10);
    const knight = s.pieces.find((p) => p.kind === "N" && p.status === "moving")!;
    expect(premoveTargets(knight).length).toBe(8);
    expect(premoveTargets(s.pieces.find((p) => p.status === "ready")!)).toEqual([]);
  });
});

describe("determinism", () => {
  test("commands on the same tick apply in the same order however they arrive", () => {
    const cmds = [move(0, "e2", "e4"), move(0, "d7", "d5"), move(0, "g1", "f3"), move(0, "b8", "c6")];
    const shuffled = [cmds[3], cmds[1], cmds[0], cmds[2]];
    expect(simulate(shuffled, 400)).toEqual(simulate(cmds, 400));
  });

  test("continuing from a saved state matches replaying from scratch", () => {
    const cmds = [move(0, "e2", "e4"), move(5, "d7", "d5"), move(100, "g1", "f3"), move(70, "b8", "c6")];
    const full = simulate(cmds, 600);
    const half = simulate(cmds, 300);
    const resumed = simulate(cmds, 600, half);
    expect(resumed).toEqual(full);
  });
});
