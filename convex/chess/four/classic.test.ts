import { describe, expect, test } from "vitest";
import { onBoard, type Color4, type Kind } from "./board";
import { initialFour, inCheck, legalMoves, legalTargetsFrom, liveColors, move4, retire4, type FourState, type Piece4 } from "./classic";

// "redK@h1"-style specs; files a..n, ranks 1..14.
const sq = (s: string): [number, number] => [s.charCodeAt(0) - 97, Number(s.slice(1)) - 1];
function custom(turn: Color4, ...specs: string[]): FourState {
  const pieces: Piece4[] = specs.map((spec, id) => {
    const [, color, kind, square] = spec.match(/^(red|blue|yellow|green)([KQRBNP])@(\w+)$/)!;
    const [x, y] = sq(square);
    return { id, color: color as Color4, kind: kind as Kind, x, y, moved: true };
  });
  return { ...initialFour(), pieces, turn };
}
const go = (s: FourState, from: string, to: string) => {
  const next = move4(s, sq(from), sq(to));
  if (!next) throw new Error(`illegal: ${from}-${to}`);
  return next;
};
// Kings parked out of the way so each army has something to do.
const KINGS = ["redK@h1", "blueK@a7", "yellowK@g14", "greenK@n8"];

describe("setup", () => {
  test("16 pieces each, kings on h1, a7, g14 and n8, nothing in the corners", () => {
    const s = initialFour();
    expect(s.pieces).toHaveLength(64);
    for (const c of ["red", "blue", "yellow", "green"] as const) expect(s.pieces.filter((p) => p.color === c)).toHaveLength(16);
    const kings = s.pieces.filter((p) => p.kind === "K").map((p) => [p.color, p.x, p.y]);
    expect(kings).toEqual([["red", 7, 0], ["blue", 0, 6], ["yellow", 6, 13], ["green", 13, 7]]);
    expect(onBoard(0, 0)).toBe(false);
    expect(onBoard(2, 11)).toBe(false);
    expect(onBoard(3, 13)).toBe(true);
  });

  test("everyone opens with 20 moves and turns go clockwise", () => {
    let s = initialFour();
    expect(legalMoves(s, "red")).toHaveLength(20);
    expect(legalMoves(s, "blue")).toHaveLength(20);
    s = go(s, "e2", "e4");
    expect(s.turn).toBe("blue");
    s = go(s, "b5", "d5");
    expect(s.turn).toBe("yellow");
    s = go(s, "f13", "f11");
    expect(s.turn).toBe("green");
    s = go(s, "m10", "k10");
    expect(s.turn).toBe("red");
  });

  test("you can only move your own pieces on your turn", () => {
    const s = initialFour();
    expect(move4(s, sq("b5"), sq("c5"))).toBeNull();
    expect(legalTargetsFrom(s, ...sq("b5"))).toEqual([]);
  });
});

describe("pieces", () => {
  test("pawns walk toward the middle for every army", () => {
    const s = initialFour();
    expect(legalTargetsFrom(s, ...sq("e2")).map(([x, y]) => [x, y])).toEqual([sq("e3"), sq("e4")]);
    const blue = { ...s, turn: "blue" as const };
    expect(legalTargetsFrom(blue, ...sq("b5"))).toEqual([sq("c5"), sq("d5")]);
    const yellow = { ...s, turn: "yellow" as const };
    expect(legalTargetsFrom(yellow, ...sq("e13"))).toEqual([sq("e12"), sq("e11")]);
    const green = { ...s, turn: "green" as const };
    expect(legalTargetsFrom(green, ...sq("m5"))).toEqual([sq("l5"), sq("k5")]);
  });

  test("pawns promote to a 1-point queen on their 8th rank", () => {
    let s = custom("red", ...KINGS, "redP@e7");
    s = go(s, "e7", "e8");
    const q = s.pieces.find((p) => p.x === 4 && p.y === 7)!;
    expect(q).toMatchObject({ kind: "Q", promoted: true });
    // The new queen also checks green's king along the 8th rank.
    expect(s.moves.at(-1)?.text).toBe("e8=Q+");
  });

  test("captures score by piece, and promoted queens are worth 1", () => {
    let s = custom("red", ...KINGS, "redR@e4", "blueN@e9", "blueQ@j4");
    s = go(s, "e4", "e9");
    expect(s.points.red).toBe(3);
    const promoted = custom("red", ...KINGS, "redR@e4", "blueQ@e9");
    promoted.pieces = promoted.pieces.map((p) => (p.kind === "Q" ? { ...p, promoted: true } : p));
    expect(go(promoted, "e4", "e9").points.red).toBe(1);
  });

  test("you can't move into check or leave your king in it", () => {
    const s = custom("red", "redK@h1", "redR@h2", "blueK@a7", "yellowR@h10", "yellowK@g14", "greenK@n8");
    // The rook on h2 is pinned against the king by yellow's rook.
    expect(legalTargetsFrom(s, ...sq("h2")).every(([x]) => x === 7)).toBe(true);
    const exposed = custom("red", "redK@h1", "blueK@a7", "yellowR@i10", "yellowK@g14", "greenK@n8");
    expect(legalTargetsFrom(exposed, ...sq("h1"))).not.toContainEqual(sq("i1"));
  });

  test("castling both ways, not through check", () => {
    const s = custom("red", "redK@h1", "redR@k1", "redR@d1", "blueK@a7", "yellowK@g14", "greenK@n8");
    s.pieces = s.pieces.map((p) => (p.color === "red" ? { ...p, moved: false } : p));
    expect(legalTargetsFrom(s, ...sq("h1"))).toEqual(expect.arrayContaining([sq("j1"), sq("f1")]));
    const short = go(s, "h1", "j1");
    expect(short.pieces.find((p) => p.kind === "R" && p.color === "red" && p.x === 8 && p.y === 0)).toBeTruthy();
    expect(short.moves.at(-1)?.text).toBe("O-O");
    const guarded = custom("red", "redK@h1", "redR@k1", "blueK@a7", "yellowR@i10", "yellowK@g14", "greenK@n8");
    guarded.pieces = guarded.pieces.map((p) => (p.color === "red" ? { ...p, moved: false } : p));
    expect(legalTargetsFrom(guarded, ...sq("h1"))).not.toContainEqual(sq("j1"));
  });
});

describe("going out", () => {
  // Yellow's king is boxed in by its own pawns; red's rook swings to the 14th rank.
  const mateSetup = () => custom("red", "redK@h1", "redR@d5", "blueK@a7", "blueP@b9", "yellowK@g14", "yellowP@f13", "yellowP@g13", "yellowP@h13", "greenK@n8", "greenP@m6");

  test("checkmate takes a player out on their turn and scores 20 for the mater", () => {
    let s = mateSetup();
    s = go(s, "d5", "d14");
    expect(inCheck(s, "yellow")).toBe(true);
    expect(s.turn).toBe("blue");
    s = go(s, "b9", "c9");
    // Yellow has no way out, so play skips to green.
    expect(s.turn).toBe("green");
    expect(s.out).toEqual([{ color: "yellow", reason: "checkmate", ply: 2 }]);
    expect(s.points.red).toBe(20);
    expect(s.pieces.filter((p) => p.color === "yellow").every((p) => p.dead)).toBe(true);
  });

  test("dead pieces stay on the board, block, and score nothing", () => {
    let s = mateSetup();
    s = go(s, "d5", "d14");
    s = go(s, "b9", "c9");
    s = go(s, "m6", "l6");
    const before = s.points.red;
    s = go(s, "d14", "f14");
    expect(s.points.red).toBe(before);
  });

  test("stalemating yourself is +20 and out", () => {
    // Green's lone king on n11 has three squares (m10, m11, n10), all covered by red's rooks, and isn't in check.
    let s = custom("red", "redK@h1", "redR@m4", "redR@f10", "blueK@a7", "yellowK@g14", "greenK@n11");
    expect(inCheck(s, "green")).toBe(false);
    s = go(s, "h1", "h2");
    s = go(s, "a7", "a8");
    s = go(s, "g14", "h14");
    expect(s.out.map((o) => [o.color, o.reason])).toContainEqual(["green", "stalemate"]);
    expect(s.points.green).toBe(20);
    expect(s.turn).toBe("red");
  });

  test("checking two kings at once scores +5", () => {
    // A knight landing on f12 forks blue's king on d11 and yellow's on g14.
    let s = custom("red", "redK@h1", "redN@e10", "blueK@d11", "yellowK@g14", "greenK@n8");
    s = go(s, "e10", "f12");
    expect(s.moves.at(-1)?.checks.sort()).toEqual(["blue", "yellow"]);
    expect(s.points.red).toBe(5);
  });

  test("resigning out of turn greys the army, and the game ends with one player left", () => {
    let s = initialFour();
    s = retire4(s, "green", "resign");
    expect(liveColors(s)).toEqual(["red", "blue", "yellow"]);
    expect(s.turn).toBe("red");
    s = go(s, "e2", "e4");
    s = retire4(s, "blue", "timeout");
    expect(s.turn).toBe("yellow");
    s = retire4(s, "yellow", "resign");
    expect(s.result?.reason).toBe("last_player");
    expect(s.turn).toBeNull();
    // Nobody scored, so the last one standing places first, then by who lasted longest.
    expect(s.result?.standings).toEqual([["red"], ["yellow"], ["blue"], ["green"]]);
  });

  test("most points wins even if someone else lasted longer", () => {
    let s = mateSetup();
    s = go(s, "d5", "d14");
    s = go(s, "b9", "c9");
    s = retire4(s, "green", "resign");
    s = retire4(s, "red", "resign");
    // Red resigned last-but-one with 20 points; blue is the last player standing with 0.
    expect(s.result?.standings[0]).toEqual(["red"]);
    expect(s.result?.standings[1]).toEqual(["blue"]);
  });

  test("fifty quiet rounds end the game and pay +10 to everyone still in", () => {
    let s = custom("red", ...KINGS);
    s.quiet = 4 * 50 - 1;
    s = go(s, "h1", "h2");
    expect(s.result?.reason).toBe("fifty");
    expect(s.points).toEqual({ red: 10, blue: 10, yellow: 10, green: 10 });
  });
});
