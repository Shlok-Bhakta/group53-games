// Turn-based four-player chess, chess.com Free-for-all rules. Pure and deterministic; no Convex imports.
//
// Players move clockwise: red, blue, yellow, green. The usual chess rules apply, with check against every
// live opponent. When it's your turn and you have no legal move you're out: checkmate gives the player who
// delivered it +20, and stalemating yourself gives you +20. Resigning or timing out also puts you out.
// Eliminated armies turn grey and stay on the board; capturing them scores nothing. Captures score
// P 1, N 3, B 5, R 5, Q 9 (promoted queens 1). Checking two kings at once scores +5 (+1 with a queen),
// three +20 (+5 with a queen). The game ends when one player is left, or after 50 rounds with no capture
// or pawn move (+10 to everyone still in). Most points wins; ties go to whoever lasted longer.

import { CASTLES, COLORS4, POINTS, SIZE, forward, onBoard, onPawnStart, promotes, rotate, setup, squareName, type Color4, type Kind } from "./board";

export type Piece4 = { id: number; color: Color4; kind: Kind; x: number; y: number; moved: boolean; promoted?: boolean; dead?: boolean };

export type Out = { color: Color4; reason: "checkmate" | "stalemate" | "resign" | "timeout"; ply: number };

export type Move4 = {
  color: Color4;
  from: [number, number];
  to: [number, number];
  kind: Kind;
  captured?: Kind;
  promoted?: boolean;
  castle?: boolean;
  checks: Color4[];
  text: string;
};

export type FourState = {
  kind: "four";
  pieces: Piece4[];
  turn: Color4 | null;
  out: Out[];
  points: Record<Color4, number>;
  moves: Move4[];
  // Plies since the last capture or pawn move.
  quiet: number;
  result: { standings: Color4[][]; reason: "last_player" | "fifty" } | null;
};

const DIAG: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const KNIGHT: [number, number][] = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];

export function initialFour(): FourState {
  return {
    kind: "four",
    pieces: setup().map((s, id) => ({ id, ...s, moved: false })),
    turn: "red",
    out: [],
    points: { red: 0, blue: 0, yellow: 0, green: 0 },
    moves: [],
    quiet: 0,
    result: null,
  };
}

export const isOut = (s: FourState, c: Color4) => s.out.some((o) => o.color === c);
export const liveColors = (s: FourState) => COLORS4.filter((c) => !isOut(s, c));

function occupancy(pieces: Piece4[]) {
  const map = new Map<number, Piece4>();
  for (const p of pieces) map.set(p.y * SIZE + p.x, p);
  return (x: number, y: number) => map.get(y * SIZE + x);
}

// Squares this piece attacks (for check), ignoring whose turn it is. Dead pieces attack nothing.
function attacks(p: Piece4, at: ReturnType<typeof occupancy>): [number, number][] {
  if (p.dead) return [];
  const out: [number, number][] = [];
  const ray = (dirs: [number, number][], max = SIZE) => {
    for (const [dx, dy] of dirs) {
      for (let i = 1; i <= max; i++) {
        const x = p.x + dx * i;
        const y = p.y + dy * i;
        if (!onBoard(x, y)) break;
        out.push([x, y]);
        if (at(x, y)) break;
      }
    }
  };
  switch (p.kind) {
    case "Q": ray([...DIAG, ...ORTH]); break;
    case "R": ray(ORTH); break;
    case "B": ray(DIAG); break;
    case "K": ray([...DIAG, ...ORTH], 1); break;
    case "N": for (const [dx, dy] of KNIGHT) if (onBoard(p.x + dx, p.y + dy)) out.push([p.x + dx, p.y + dy]); break;
    case "P": {
      const [fx, fy] = forward(p.color);
      // Diagonal-forward squares: forward plus either sideways direction.
      for (const s of [-1, 1]) {
        const x = p.x + fx + (fy !== 0 ? s : 0);
        const y = p.y + fy + (fx !== 0 ? s : 0);
        if (onBoard(x, y)) out.push([x, y]);
      }
      break;
    }
  }
  return out;
}

function squareAttackedBy(pieces: Piece4[], x: number, y: number, by: Color4[]) {
  const at = occupancy(pieces);
  return pieces.some((p) => by.includes(p.color) && !p.dead && attacks(p, at).some(([ax, ay]) => ax === x && ay === y));
}

const king = (pieces: Piece4[], c: Color4) => pieces.find((p) => p.kind === "K" && p.color === c && !p.dead);

export function inCheck(s: FourState, c: Color4, pieces = s.pieces) {
  const k = king(pieces, c);
  if (!k) return false;
  return squareAttackedBy(pieces, k.x, k.y, liveColors(s).filter((o) => o !== c));
}

type Candidate = { pieceId: number; to: [number, number]; castle?: (typeof CASTLES)[number] };

function pseudoMoves(s: FourState, p: Piece4): Candidate[] {
  const at = occupancy(s.pieces);
  const out: Candidate[] = [];
  const canLand = (x: number, y: number) => {
    const q = at(x, y);
    return !q || q.color !== p.color || q.dead;
  };
  if (p.kind === "P") {
    const [fx, fy] = forward(p.color);
    const one: [number, number] = [p.x + fx, p.y + fy];
    if (onBoard(...one) && !at(...one)) {
      out.push({ pieceId: p.id, to: one });
      const two: [number, number] = [p.x + 2 * fx, p.y + 2 * fy];
      if (onPawnStart(p.color, p.x, p.y) && onBoard(...two) && !at(...two)) out.push({ pieceId: p.id, to: two });
    }
    for (const [x, y] of attacks(p, at)) {
      const q = at(x, y);
      if (q && (q.color !== p.color || q.dead)) out.push({ pieceId: p.id, to: [x, y] });
    }
    return out;
  }
  for (const [x, y] of attacks(p, at)) if (canLand(x, y)) out.push({ pieceId: p.id, to: [x, y] });
  if (p.kind === "K" && !p.moved) {
    for (const c of CASTLES) {
      const [kx, ky] = rotate(p.color, c.king[0], c.king[1]);
      if (kx !== p.x || ky !== p.y) continue;
      const [rx, ry] = rotate(p.color, c.rook[0], c.rook[1]);
      const rook = at(rx, ry);
      if (!rook || rook.kind !== "R" || rook.color !== p.color || rook.moved || rook.dead) continue;
      if (c.between.some(([bx, by]) => at(...rotate(p.color, bx, by)))) continue;
      out.push({ pieceId: p.id, to: rotate(p.color, c.kingTo[0], c.kingTo[1]), castle: c });
    }
  }
  return out;
}

function play(s: FourState, m: Candidate): { pieces: Piece4[]; captured?: Piece4; promoted: boolean } {
  const mover = s.pieces.find((p) => p.id === m.pieceId)!;
  const captured = s.pieces.find((p) => p.x === m.to[0] && p.y === m.to[1] && p.id !== mover.id);
  const promoted = mover.kind === "P" && promotes(mover.color, m.to[0], m.to[1]);
  let pieces = s.pieces.filter((p) => p !== captured).map((p) => (p.id === mover.id ? { ...p, x: m.to[0], y: m.to[1], moved: true, ...(promoted ? { kind: "Q" as Kind, promoted: true } : {}) } : p));
  if (m.castle) {
    const [rx, ry] = rotate(mover.color, m.castle.rook[0], m.castle.rook[1]);
    const [tx, ty] = rotate(mover.color, m.castle.rookTo[0], m.castle.rookTo[1]);
    pieces = pieces.map((p) => (p.x === rx && p.y === ry && p.kind === "R" ? { ...p, x: tx, y: ty, moved: true } : p));
  }
  return { pieces, captured, promoted };
}

// Every legal move for this color: pseudo-legal moves that don't leave its own king attacked, and castling
// that doesn't start in, pass through, or land in check.
export function legalMoves(s: FourState, color: Color4): Candidate[] {
  if (isOut(s, color)) return [];
  const enemies = liveColors(s).filter((c) => c !== color);
  const out: Candidate[] = [];
  for (const p of s.pieces) {
    if (p.color !== color || p.dead) continue;
    for (const m of pseudoMoves(s, p)) {
      if (m.castle) {
        if (inCheck(s, color)) continue;
        if (m.castle.kingPath.some(([x, y]) => squareAttackedBy(s.pieces, ...rotate(color, x, y), enemies))) continue;
      }
      const after = play(s, m).pieces;
      const k = king(after, color);
      if (k && !squareAttackedBy(after, k.x, k.y, enemies)) out.push(m);
    }
  }
  return out;
}

export function legalTargetsFrom(s: FourState, x: number, y: number): [number, number][] {
  const p = s.pieces.find((q) => q.x === x && q.y === y);
  if (!p || p.dead || p.color !== s.turn) return [];
  return legalMoves(s, p.color).filter((m) => m.pieceId === p.id).map((m) => m.to);
}

function eliminate(s: FourState, color: Color4, reason: Out["reason"]) {
  s.out.push({ color, reason, ply: s.moves.length });
  s.pieces = s.pieces.map((p) => (p.color === color ? { ...p, dead: true } : p));
}

const nextLive = (s: FourState, after: Color4): Color4 | null => {
  const i = COLORS4.indexOf(after);
  for (let k = 1; k <= 4; k++) {
    const c = COLORS4[(i + k) % 4];
    if (!isOut(s, c)) return c;
  }
  return null;
};

// Settles whose turn it is: skips past players with no legal move (checkmate or stalemate puts them out),
// and ends the game when one player is left or the fifty-round rule triggers.
function advance(s: FourState, lastMover: Color4) {
  let c = nextLive(s, lastMover);
  while (c && liveColors(s).length > 1) {
    if (legalMoves(s, c).length > 0) break;
    if (inCheck(s, c)) {
      // Credit the mate to the most recent mover whose pieces are attacking the king, else the last mover.
      const k = king(s.pieces, c)!;
      const order = [...s.moves].reverse().map((m) => m.color);
      const by = order.find((o) => o !== c && !isOut(s, o) && squareAttackedBy(s.pieces, k.x, k.y, [o])) ?? lastMover;
      s.points[by] += 20;
      eliminate(s, c, "checkmate");
    } else {
      s.points[c] += 20;
      eliminate(s, c, "stalemate");
    }
    c = nextLive(s, c);
  }
  const live = liveColors(s);
  if (live.length <= 1) {
    s.turn = null;
    s.result = { standings: standings(s), reason: "last_player" };
  } else if (s.quiet >= 50 * live.length) {
    for (const l of live) s.points[l] += 10;
    s.turn = null;
    s.result = { standings: standings(s), reason: "fifty" };
  } else {
    s.turn = c;
  }
}

// Final placings, best first. More points places higher; on a tie, whoever lasted longer.
export function standings(s: FourState): Color4[][] {
  // Position in the order players went out; still in counts as lasting longest.
  const lasted = (c: Color4) => {
    const i = s.out.findIndex((x) => x.color === c);
    return i < 0 ? Infinity : i;
  };
  const sorted = [...COLORS4].sort((a, b) => s.points[b] - s.points[a] || lasted(b) - lasted(a));
  const groups: Color4[][] = [];
  for (const c of sorted) {
    const g = groups.at(-1);
    if (g && s.points[g[0]] === s.points[c] && lasted(g[0]) === lasted(c)) g.push(c);
    else groups.push([c]);
  }
  return groups;
}

// Plays a move for whoever's turn it is. Returns the new state, or null if the move isn't legal.
export function move4(s: FourState, from: [number, number], to: [number, number]): FourState | null {
  if (s.result || !s.turn) return null;
  const color = s.turn;
  const piece = s.pieces.find((p) => p.x === from[0] && p.y === from[1]);
  if (!piece || piece.color !== color || piece.dead) return null;
  const m = legalMoves(s, color).find((c) => c.pieceId === piece.id && c.to[0] === to[0] && c.to[1] === to[1]);
  if (!m) return null;
  const next: FourState = structuredClone(s);
  const { pieces, captured, promoted } = play(next, m);
  next.pieces = pieces;
  if (captured && !captured.dead) next.points[color] += captured.promoted ? 1 : POINTS[captured.kind];
  next.quiet = captured || piece.kind === "P" ? 0 : next.quiet + 1;

  // Check bonuses: kings of other live players now attacked by this player's pieces.
  const checks = liveColors(next).filter((c) => c !== color && (() => {
    const k = king(next.pieces, c);
    return !!k && squareAttackedBy(next.pieces, k.x, k.y, [color]);
  })());
  const withQueen = piece.kind === "Q" || promoted;
  if (checks.length === 2) next.points[color] += withQueen ? 1 : 5;
  if (checks.length >= 3) next.points[color] += withQueen ? 5 : 20;

  const text = `${piece.kind === "P" ? "" : piece.kind}${captured ? "x" : ""}${squareName(...to)}${promoted ? "=Q" : ""}${checks.length ? "+" : ""}`;
  next.moves.push({ color, from, to, kind: piece.kind, captured: captured?.kind, promoted: promoted || undefined, castle: !!m.castle || undefined, checks, text: m.castle ? (m.castle.kingTo[0] === 9 ? "O-O" : "O-O-O") : text });
  advance(next, color);
  return next;
}

// Takes a player out without a move (resignation or timing out). Their army goes grey.
export function retire4(s: FourState, color: Color4, reason: "resign" | "timeout"): FourState {
  if (s.result || isOut(s, color)) return s;
  const next: FourState = structuredClone(s);
  const wasTurn = next.turn === color;
  eliminate(next, color, reason);
  if (wasTurn) advance(next, color);
  else if (liveColors(next).length <= 1) {
    next.turn = null;
    next.result = { standings: standings(next), reason: "last_player" };
  }
  return next;
}
