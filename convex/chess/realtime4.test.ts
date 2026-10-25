import { describe, expect, test } from "vitest";
import { TICKS_PER_SQUARE, initialState, legalTargets, premoveTargets, simulate, type Command, type Piece, type State } from "./realtime";

const sq = (s: string): [number, number] => [s.charCodeAt(0) - 97, Number(s.slice(1)) - 1];
const name = ([x, y]: [number, number]) => `${String.fromCharCode(97 + x)}${y + 1}`;

// A four-player position: "redK@h1" specs, all ready, not first moves.
function position(...specs: string[]): State {
  const pieces: Piece[] = specs.map((spec, id) => {
    const [, color, kind, square] = spec.match(/^(red|blue|yellow|green)([KQRBNP])@(\w+)$/)!;
    const [x, y] = sq(square);
    return { id, color, kind: kind as Piece["kind"], x, y, firstMove: false, status: "ready" };
  });
  return { ...initialState("four"), pieces };
}
const at = (s: State, square: string) => {
  const [x, y] = sq(square);
  return s.pieces.find((p) => p.status !== "moving" && p.x === x && p.y === y);
};
const targets = (s: State, square: string) => legalTargets(s.pieces, at(s, square)!, "four").map(name).sort();
const cmd = (s: State, tick: number, from: string, to: string): Command => {
  const p = at(s, from)!;
  const [toX, toY] = sq(to);
  return { tick, color: p.color, pieceId: p.id, toX, toY };
};

describe("four-player real-time", () => {
  test("starts with four armies of 16", () => {
    const s = initialState("four");
    expect(s.pieces).toHaveLength(64);
    expect(new Set(s.pieces.map((p) => p.color))).toEqual(new Set(["red", "blue", "yellow", "green"]));
  });

  test("every army's pawns walk toward the middle, two squares from the start", () => {
    const s = initialState("four");
    expect(targets(s, "e2")).toEqual(["e3", "e4"]);
    expect(targets(s, "b5")).toEqual(["c5", "d5"]);
    expect(targets(s, "e13")).toEqual(["e11", "e12"]);
    expect(targets(s, "m5")).toEqual(["k5", "l5"]);
  });

  test("everyone can move at once", () => {
    const s0 = initialState("four");
    const cmds = [cmd(s0, 0, "e2", "e3"), cmd(s0, 0, "b5", "c5"), cmd(s0, 0, "e13", "e12"), cmd(s0, 0, "m5", "l5")];
    const s = simulate(cmds, TICKS_PER_SQUARE + 1, s0);
    expect(["e3", "c5", "e12", "l5"].map((q) => at(s, q)?.status)).toEqual(["cooldown", "cooldown", "cooldown", "cooldown"]);
  });

  test("pawns promote on their 8th rank, the middle line", () => {
    // Blue walks along the ranks, so its 8th rank is the h-file.
    const s = position("redP@e7", "redK@h1", "blueK@a7", "yellowK@g14", "greenK@n8", "blueP@g9");
    const after = simulate([cmd(s, 0, "e7", "e8")], TICKS_PER_SQUARE + 1, s);
    expect(at(after, "e8")?.kind).toBe("Q");
    const blue = simulate([cmd(s, 0, "g9", "h9")], TICKS_PER_SQUARE + 1, s);
    expect(at(blue, "h9")?.kind).toBe("Q");
  });

  test("losing your king puts you out and greys your army in place", () => {
    const s = position("redK@h1", "redR@a6", "blueK@a7", "blueR@b4", "yellowK@g14", "greenK@n8");
    const after = simulate([cmd(s, 0, "a6", "a7")], TICKS_PER_SQUARE + 1, s);
    expect(after.out).toEqual([{ color: "blue", tick: expect.any(Number) }]);
    expect(at(after, "b4")).toMatchObject({ color: "blue", dead: true });
    expect(after.result).toBeNull();
  });

  test("grey pieces block, can be captured, and ignore their old owner", () => {
    const s = position("redK@h1", "redR@a6", "blueK@a7", "blueR@b4", "yellowK@g14", "greenK@n8", "greenR@n4");
    let after = simulate([cmd(s, 0, "a6", "a7")], TICKS_PER_SQUARE + 1, s);
    const greyRook = at(after, "b4")!;
    // Blue can't move any more.
    after = simulate([{ tick: after.tick, color: "blue", pieceId: greyRook.id, toX: 1, toY: 8 }], after.tick + 40, after);
    expect(at(after, "b4")?.dead).toBe(true);
    // Green's rook stops at the grey rook and can take it.
    expect(targets(after, "n4")).toContain("b4");
    expect(targets(after, "n4")).not.toContain("a4");
  });

  test("last king standing wins, and the rest place by how long they lasted", () => {
    const s = position("redK@h1", "redR@a6", "redR@n6", "redQ@g10", "blueK@a7", "yellowK@g14", "greenK@n8");
    const cmds: Command[] = [cmd(s, 0, "a6", "a7"), cmd(s, 60, "n6", "n8"), cmd(s, 200, "g10", "g14")];
    const after = simulate(cmds, 600, s);
    expect(after.result).toMatchObject({ winner: "red", reason: "last_king" });
    expect(after.result?.ranking).toEqual([["red"], ["yellow"], ["green"], ["blue"]]);
  });

  test("resigning greys your army; the last one left wins", () => {
    const s0 = initialState("four");
    const resign = (tick: number, color: string): Command => ({ tick, color, pieceId: 0, toX: 0, toY: 0, kind: "resign" });
    let s = simulate([resign(10, "green")], 20, s0);
    expect(s.out).toEqual([{ color: "green", tick: 10 }]);
    expect(s.pieces.filter((p) => p.color === "green").every((p) => p.dead)).toBe(true);
    // A grey army can't move or resign again.
    const greenPawn = s.pieces.find((p) => p.color === "green" && p.kind === "P")!;
    s = simulate([resign(10, "green"), { tick: 20, color: "green", pieceId: greenPawn.id, toX: greenPawn.x - 1, toY: greenPawn.y }, resign(25, "green")], 40, s0);
    expect(s.out).toHaveLength(1);
    expect(s.pieces.find((p) => p.id === greenPawn.id)).toMatchObject({ x: greenPawn.x, dead: true });
    s = simulate([resign(10, "green"), resign(30, "blue"), resign(50, "red")], 80, s0);
    expect(s.result).toMatchObject({ winner: "yellow", reason: "last_king" });
    expect(s.result?.ranking).toEqual([["yellow"], ["red"], ["blue"], ["green"]]);
    expect(s.endTick).toBe(50);
  });

  test("no castling in four-player", () => {
    const s = position("redK@h1", "redR@k1", "blueK@a7", "yellowK@g14", "greenK@n8");
    s.pieces = s.pieces.map((p) => ({ ...p, firstMove: true }));
    expect(targets(s, "h1")).not.toContain("j1");
  });

  test("premoves follow the four-player board", () => {
    const s0 = position("redK@h1", "blueP@b5", "yellowK@g14", "greenK@n8", "blueK@a7");
    const s = simulate([cmd(s0, 0, "b5", "c5")], 5, s0);
    const pawn = s.pieces.find((p) => p.color === "blue" && p.kind === "P")!;
    expect(premoveTargets(pawn, "four").map(name).sort()).toEqual(["d4", "d5", "d6"]);
  });
});
