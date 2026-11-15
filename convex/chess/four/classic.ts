import {
  CASTLES,
  COLORS4,
  POINTS,
  SIZE,
  forward,
  onBoard,
  onPawnStart,
  promotes,
  rotate,
  setup,
  squareName,
  type Color4,
  type Kind,
} from "./board";

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
  quiet: number;
  result: { standings: Color4[][]; reason: "last_player" | "fifty" } | null;
};

const DIAG: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ORTH: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const KNIGHT: [number, number][] = [
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
];

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
    case "Q":
      ray([...DIAG, ...ORTH]);
      break;
    case "R":
      ray(ORTH);
      break;
    case "B":
      ray(DIAG);
      break;
    case "K":
      ray([...DIAG, ...ORTH], 1);
      break;
    case "N":
      for (const [dx, dy] of KNIGHT) if (onBoard(p.x + dx, p.y + dy)) out.push([p.x + dx, p.y + dy]);
      break;
    case "P": {
      const [fx, fy] = forward(p.color);
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
  return squareAttackedBy(
    pieces,
    k.x,
    k.y,
    liveColors(s).filter((o) => o !== c),
  );
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
  let pieces = s.pieces
    .filter((p) => p !== captured)
    .map((p) =>
      p.id === mover.id ? { ...p, x: m.to[0], y: m.to[1], moved: true, ...(promoted ? { kind: "Q" as Kind, promoted: true } : {}) } : p,
    );
  if (m.castle) {
    const [rx, ry] = rotate(mover.color, m.castle.rook[0], m.castle.rook[1]);
    const [tx, ty] = rotate(mover.color, m.castle.rookTo[0], m.castle.rookTo[1]);
    pieces = pieces.map((p) => (p.x === rx && p.y === ry && p.kind === "R" ? { ...p, x: tx, y: ty, moved: true } : p));
  }
  return { pieces, captured, promoted };
}

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
  return legalMoves(s, p.color)
    .filter((m) => m.pieceId === p.id)
    .map((m) => m.to);
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

function advance(s: FourState, lastMover: Color4) {
  let c = nextLive(s, lastMover);
  while (c && liveColors(s).length > 1) {
    if (legalMoves(s, c).length > 0) break;
    if (inCheck(s, c)) {
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

export function standings(s: FourState): Color4[][] {
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

  const checks = liveColors(next).filter(
    (c) =>
      c !== color &&
      (() => {
        const k = king(next.pieces, c);
        return !!k && squareAttackedBy(next.pieces, k.x, k.y, [color]);
      })(),
  );
  const withQueen = piece.kind === "Q" || promoted;
  if (checks.length === 2) next.points[color] += withQueen ? 1 : 5;
  if (checks.length >= 3) next.points[color] += withQueen ? 5 : 20;

  const text = `${piece.kind === "P" ? "" : piece.kind}${captured ? "x" : ""}${squareName(...to)}${promoted ? "=Q" : ""}${checks.length ? "+" : ""}`;
  next.moves.push({
    color,
    from,
    to,
    kind: piece.kind,
    captured: captured?.kind,
    promoted: promoted || undefined,
    castle: !!m.castle || undefined,
    checks,
    text: m.castle ? (m.castle.kingTo[0] === 9 ? "O-O" : "O-O-O") : text,
  });
  advance(next, color);
  return next;
}

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

export type FourBoard = Pick<FourState, "pieces" | "out" | "turn">;
export function fourBoards(s: FourState): FourBoard[] {
  let pieces = initialFour().pieces;
  const outBy = (ply: number) => s.out.filter((o) => o.ply <= ply);
  const grey = (ps: Piece4[], out: Out[]) =>
    out.length ? ps.map((p) => (out.some((o) => o.color === p.color) ? { ...p, dead: true } : p)) : ps;
  const boards: FourBoard[] = [{ pieces, out: outBy(0), turn: s.moves[0]?.color ?? s.turn }];
  for (let i = 0; i < s.moves.length; i++) {
    const m = s.moves[i];
    const at: FourState = { ...s, pieces, out: outBy(i) };
    const mover = pieces.find((p) => !p.dead && p.x === m.from[0] && p.y === m.from[1]);
    const c = mover && pseudoMoves(at, mover).find((c) => c.to[0] === m.to[0] && c.to[1] === m.to[1]);
    if (!c) break;
    const out = outBy(i + 1);
    pieces = play(at, c).pieces;
    boards.push({ pieces: grey(pieces, out), out, turn: s.moves[i + 1]?.color ?? s.turn });
  }
  return boards;
}
