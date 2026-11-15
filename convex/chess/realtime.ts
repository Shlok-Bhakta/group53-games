import { COLORS4, forward as forward4, onBoard as onBoard4, promotes as promotes4, setup as setup4, type Color4 } from "./four/board.ts";

export const TICKS_PER_SECOND = 30;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
export const CELL = 120;
export const TICKS_PER_SQUARE = 30;
export const COOLDOWN_TICKS = 150;
export const NO_PROGRESS_TICKS = 90 * TICKS_PER_SECOND;
export const KNIGHT_LANDING = 0.75;
const HIT = CELL / 2;

export type Variant = "two" | "four";
export type Color = string;
export type Kind = "P" | "N" | "B" | "R" | "Q" | "K";

const COLORS: Record<Variant, readonly string[]> = { two: ["w", "b"], four: COLORS4 };
const SIZES: Record<Variant, number> = { two: 8, four: 14 };
const insideFor = (v: Variant) => (v === "two" ? (x: number, y: number) => x >= 0 && x < 8 && y >= 0 && y < 8 : onBoard4);
const forwardFor = (v: Variant, color: Color): [number, number] => (v === "two" ? [0, color === "w" ? 1 : -1] : forward4(color as Color4));
const promotesAt = (v: Variant, color: Color, x: number, y: number) =>
  v === "two" ? y === (color === "w" ? 7 : 0) : promotes4(color as Color4, x, y);
const pawnDiagonals = (v: Variant, p: { color: Color; x: number; y: number }): [number, number][] => {
  const [fx, fy] = forwardFor(v, p.color);
  return [-1, 1].map((s) => [p.x + fx + (fy !== 0 ? s : 0), p.y + fy + (fx !== 0 ? s : 0)] as [number, number]);
};

export type Piece = {
  id: number;
  color: Color;
  kind: Kind;
  x: number;
  y: number;
  firstMove: boolean;
  status: "ready" | "moving" | "cooldown";
  toX?: number;
  toY?: number;
  startTick?: number;
  duration?: number;
  readyAt?: number;
  pending?: { toX: number; toY: number };
  dead?: boolean;
};

export type Command = { tick: number; color: Color; pieceId: number; toX: number; toY: number; kind?: "move" | "cancel" | "resign" };

const COLOR_RANK: Record<string, number> = { w: 0, b: 1, red: 0, blue: 1, yellow: 2, green: 3 };
export const commandOrder = (a: Command, b: Command) =>
  a.tick - b.tick ||
  (COLOR_RANK[a.color] ?? 9) - (COLOR_RANK[b.color] ?? 9) ||
  a.pieceId - b.pieceId ||
  (a.kind === "cancel" ? 1 : 0) - (b.kind === "cancel" ? 1 : 0);

export type Result = { winner: Color | null; reason: "king" | "both_kings" | "no_progress" | "last_king"; ranking: Color[][] };

export type Capture = { tick: number; pieceId: number; by: number; x: number; y: number };

export type Pace = { square: number; cooldown: number };
export const DEFAULT_PACE: Pace = { square: TICKS_PER_SQUARE, cooldown: COOLDOWN_TICKS };
export const paceOf = (state: { pace?: Pace }) => state.pace ?? DEFAULT_PACE;
export const paceFromSettings = (settings: Record<string, number>): Pace => ({
  square: settings.speed ?? TICKS_PER_SQUARE,
  cooldown: (settings.cooldown ?? COOLDOWN_TICKS / TICKS_PER_SECOND) * TICKS_PER_SECOND,
});

export type State = {
  variant: Variant;
  pace?: Pace;
  out: { color: Color; tick: number }[];
  tick: number;
  pieces: Piece[];
  captures: Capture[];
  lastProgressTick: number;
  result: Result | null;
  endTick: number | null;
};

const BACK_RANK: Kind[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];

export function initialPieces(variant: Variant = "two"): Piece[] {
  if (variant === "four")
    return setup4().map((s, id) => ({ id, color: s.color, kind: s.kind, x: s.x, y: s.y, firstMove: true, status: "ready" }));
  const pieces: Piece[] = [];
  let id = 0;
  for (const color of ["w", "b"] as const) {
    const back = color === "w" ? 0 : 7;
    const pawns = color === "w" ? 1 : 6;
    for (let x = 0; x < 8; x++) pieces.push({ id: id++, color, kind: BACK_RANK[x], x, y: back, firstMove: true, status: "ready" });
    for (let x = 0; x < 8; x++) pieces.push({ id: id++, color, kind: "P", x, y: pawns, firstMove: true, status: "ready" });
  }
  return pieces;
}

export function initialState(variant: Variant = "two", pace?: Pace): State {
  return {
    variant,
    ...(pace ? { pace } : {}),
    out: [],
    tick: 0,
    pieces: initialPieces(variant),
    captures: [],
    lastProgressTick: 0,
    result: null,
    endTick: null,
  };
}

export function positionAt(p: Piece, tick: number): { x: number; y: number } {
  if (p.status !== "moving") return { x: p.x * CELL, y: p.y * CELL };
  const progress = Math.min(1, Math.max(0, (tick - p.startTick!) / p.duration!));
  return { x: (p.x + (p.toX! - p.x) * progress) * CELL, y: (p.y + (p.toY! - p.y) * progress) * CELL };
}

function progressAt(p: Piece, tick: number) {
  return p.status === "moving" ? (tick - p.startTick!) / p.duration! : 1;
}

type Square = { rest: Color | null; incoming: Set<Color> };

function boardOf(pieces: Piece[], size: number): Square[][] {
  const board: Square[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ rest: null, incoming: new Set<Color>() })),
  );
  for (const p of pieces) {
    if (p.status === "moving") board[p.toY!][p.toX!].incoming.add(p.color);
    else board[p.y][p.x].rest = p.dead ? "dead" : p.color;
  }
  return board;
}

export function legalTargets(pieces: Piece[], piece: Piece, variant: Variant = "two"): [number, number][] {
  if (piece.status !== "ready" || piece.dead) return [];
  const size = SIZES[variant];
  const inside = insideFor(variant);
  const board = boardOf(pieces, size);
  const me = piece.color;
  const enemyAt = (x: number, y: number) => board[y][x].rest !== null && board[y][x].rest !== me;
  const out: [number, number][] = [];
  const blockedByOwn = (x: number, y: number) => board[y][x].rest === me || board[y][x].incoming.has(me);

  const slide = (dirs: [number, number][]) => {
    for (const [dx, dy] of dirs) {
      for (let i = 1; i < size; i++) {
        const x = piece.x + dx * i;
        const y = piece.y + dy * i;
        if (!inside(x, y) || blockedByOwn(x, y)) break;
        out.push([x, y]);
        if (enemyAt(x, y)) break;
      }
    }
  };
  const step = (offsets: [number, number][]) => {
    for (const [dx, dy] of offsets) {
      const x = piece.x + dx;
      const y = piece.y + dy;
      if (inside(x, y) && !blockedByOwn(x, y)) out.push([x, y]);
    }
  };

  switch (piece.kind) {
    case "Q":
      slide([
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]);
      break;
    case "R":
      slide([
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]);
      break;
    case "B":
      slide([
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]);
      break;
    case "N":
      step([
        [2, 1],
        [2, -1],
        [-2, 1],
        [-2, -1],
        [1, 2],
        [1, -2],
        [-1, 2],
        [-1, -2],
      ]);
      break;
    case "K": {
      step([
        [1, 1],
        [1, 0],
        [1, -1],
        [0, 1],
        [0, -1],
        [-1, 1],
        [-1, 0],
        [-1, -1],
      ]);
      if (piece.firstMove && variant === "two") {
        for (const rook of pieces) {
          if (rook.kind !== "R" || rook.color !== me || !rook.firstMove || rook.status !== "ready" || rook.y !== piece.y) continue;
          const between = rook.x === 0 ? [1, 2, 3] : rook.x === 7 ? [5, 6] : null;
          if (!between) continue;
          const clear = between.every((x) => board[piece.y][x].rest === null && !board[piece.y][x].incoming.has(me));
          if (clear) out.push([rook.x === 0 ? 2 : 6, piece.y]);
        }
      }
      break;
    }
    case "P": {
      const [fx, fy] = forwardFor(variant, me);
      for (let i = 1; i <= (piece.firstMove ? 2 : 1); i++) {
        const x = piece.x + fx * i;
        const y = piece.y + fy * i;
        if (!inside(x, y) || board[y][x].rest !== null || board[y][x].incoming.has(me)) break;
        out.push([x, y]);
      }
      for (const [x, y] of pawnDiagonals(variant, piece)) {
        if (inside(x, y) && enemyAt(x, y) && !board[y][x].incoming.has(me)) out.push([x, y]);
      }
      break;
    }
  }
  return out;
}

export function premoveTargets(piece: Piece, variant: Variant = "two"): [number, number][] {
  if (piece.status === "ready" || piece.dead) return [];
  const inside = insideFor(variant);
  const size = SIZES[variant];
  const fromX = piece.status === "moving" ? piece.toX! : piece.x;
  const fromY = piece.status === "moving" ? piece.toY! : piece.y;
  const out: [number, number][] = [];
  const add = (x: number, y: number) => inside(x, y) && !(x === fromX && y === fromY) && out.push([x, y]);
  const ray = (dirs: [number, number][]) =>
    dirs.forEach(([dx, dy]) => {
      for (let i = 1; i < size; i++) add(fromX + dx * i, fromY + dy * i);
    });
  const diag: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const orth: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  switch (piece.kind) {
    case "Q":
      ray([...diag, ...orth]);
      break;
    case "R":
      ray(orth);
      break;
    case "B":
      ray(diag);
      break;
    case "N":
      for (const [dx, dy] of [
        [2, 1],
        [2, -1],
        [-2, 1],
        [-2, -1],
        [1, 2],
        [1, -2],
        [-1, 2],
        [-1, -2],
      ])
        add(fromX + dx, fromY + dy);
      break;
    case "K":
      for (const [dx, dy] of [...diag, ...orth]) add(fromX + dx, fromY + dy);
      break;
    case "P": {
      const [fx, fy] = forwardFor(variant, piece.color);
      add(fromX + fx, fromY + fy);
      for (const [x, y] of pawnDiagonals(variant, { color: piece.color, x: fromX, y: fromY })) add(x, y);
      break;
    }
  }
  return out;
}

function startMove(p: Piece, toX: number, toY: number, tick: number, duration: number): Piece {
  return { ...p, status: "moving", toX, toY, startTick: tick, duration, firstMove: false, readyAt: undefined, pending: undefined };
}

export function applyCommand(state: State, cmd: Command): boolean {
  if (state.result) return false;
  if (state.out.some((o) => o.color === cmd.color)) return false;
  if (cmd.kind === "resign") {
    if (state.variant !== "four" || !COLORS.four.includes(cmd.color)) return false;
    knockOut(state, new Set([cmd.color]), state.tick);
    return true;
  }
  const piece = state.pieces.find((p) => p.id === cmd.pieceId);
  if (!piece || piece.color !== cmd.color || piece.dead) return false;
  if (cmd.kind === "cancel") {
    if (!piece.pending) return false;
    state.pieces = state.pieces.map((p) => (p.id === piece.id ? { ...p, pending: undefined } : p));
    return true;
  }
  if (piece.status !== "ready") {
    if (!premoveTargets(piece, state.variant).some(([x, y]) => x === cmd.toX && y === cmd.toY)) return false;
    state.pieces = state.pieces.map((p) => (p.id === piece.id ? { ...p, pending: { toX: cmd.toX, toY: cmd.toY } } : p));
    return true;
  }
  return startReadyMove(state, piece, cmd.toX, cmd.toY);
}

function startReadyMove(state: State, piece: Piece, toX: number, toY: number): boolean {
  const cmd = { toX, toY };
  if (!legalTargets(state.pieces, piece, state.variant).some(([x, y]) => x === cmd.toX && y === cmd.toY)) return false;
  const tick = state.tick;
  const perSquare = paceOf(state).square;

  if (state.variant === "two" && piece.kind === "K" && Math.abs(cmd.toX - piece.x) === 2) {
    const kingside = cmd.toX === 6;
    const rook = state.pieces.find((p) => p.kind === "R" && p.color === piece.color && p.y === piece.y && p.x === (kingside ? 7 : 0))!;
    const duration = (kingside ? 2 : 3) * perSquare;
    state.pieces = state.pieces.map((p) =>
      p.id === piece.id
        ? startMove(p, cmd.toX, cmd.toY, tick, duration)
        : p.id === rook.id
          ? startMove(p, kingside ? 5 : 3, p.y, tick, duration)
          : p,
    );
  } else {
    const duration = Math.max(Math.abs(cmd.toX - piece.x), Math.abs(cmd.toY - piece.y)) * perSquare;
    state.pieces = state.pieces.map((p) => (p.id === piece.id ? startMove(p, cmd.toX, cmd.toY, tick, duration) : p));
  }
  if (piece.kind === "P") state.lastProgressTick = tick;
  return true;
}

function knockOut(state: State, lost: Set<Color>, t: number) {
  for (const color of lost) state.out.push({ color, tick: t });
  state.pieces = state.pieces.map((p) => {
    if (!lost.has(p.color)) return p;
    const at = positionAt(p, t);
    return {
      id: p.id,
      color: p.color,
      kind: p.kind,
      x: Math.round(at.x / CELL),
      y: Math.round(at.y / CELL),
      firstMove: false,
      status: "ready",
      dead: true,
    };
  });
  const live = COLORS.four.filter((c) => !state.out.some((o) => o.color === c));
  if (live.length <= 1) {
    state.result = { winner: live[0] ?? null, reason: live.length ? "last_king" : "both_kings", ranking: rankingOf(state, live) };
    state.endTick = t;
  }
}

function stepTick(state: State) {
  const t = state.tick;
  const pos = new Map(state.pieces.map((p) => [p.id, positionAt(p, t)]));
  const captured = new Set<number>();

  const moving = state.pieces.filter((p) => p.status === "moving" && (p.kind !== "N" || progressAt(p, t) >= KNIGHT_LANDING));
  for (const a of moving) {
    for (const b of state.pieces) {
      if (a.id === b.id || a.color === b.color || captured.has(a.id) || captured.has(b.id)) continue;
      if (b.status === "moving" && b.kind === "N" && progressAt(b, t) < KNIGHT_LANDING) continue;
      const pa = pos.get(a.id)!;
      const pb = pos.get(b.id)!;
      if (Math.abs(pa.x - pb.x) >= HIT || Math.abs(pa.y - pb.y) >= HIT) continue;
      const loser = b.status !== "moving" ? [b] : a.startTick! < b.startTick! ? [b] : b.startTick! < a.startTick! ? [a] : [a, b];
      for (const l of loser) {
        const winner = l.id === a.id ? b : a;
        captured.add(l.id);
        const lp = pos.get(l.id)!;
        state.captures.push({ tick: t, pieceId: l.id, by: loser.length === 2 ? -1 : winner.id, x: lp.x / CELL, y: lp.y / CELL });
      }
    }
  }
  if (captured.size > 0) {
    const kingsLost = state.pieces.filter((p) => p.kind === "K" && !p.dead && captured.has(p.id));
    state.pieces = state.pieces.filter((p) => !captured.has(p.id));
    state.lastProgressTick = t;
    if (state.variant === "two") {
      if (kingsLost.length === 2) state.result = { winner: null, reason: "both_kings", ranking: [["w", "b"]] };
      else if (kingsLost.length === 1) {
        const winner = kingsLost[0].color === "w" ? "b" : "w";
        state.result = { winner, reason: "king", ranking: [[winner], [kingsLost[0].color]] };
      }
    } else if (kingsLost.length > 0) {
      knockOut(state, new Set(kingsLost.map((k) => k.color)), t);
    }
  }

  const cooldown = paceOf(state).cooldown;
  state.pieces = state.pieces.map((p) => {
    if (p.status === "moving" && t >= p.startTick! + p.duration!) {
      const kind: Kind = p.kind === "P" && promotesAt(state.variant, p.color, p.toX!, p.toY!) ? "Q" : p.kind;
      return {
        id: p.id,
        color: p.color,
        kind,
        x: p.toX!,
        y: p.toY!,
        firstMove: p.firstMove,
        status: "cooldown",
        readyAt: t + cooldown,
        pending: p.pending,
      };
    }
    if (p.status === "cooldown" && t >= p.readyAt!)
      return {
        id: p.id,
        color: p.color,
        kind: p.kind,
        x: p.x,
        y: p.y,
        firstMove: p.firstMove,
        status: "ready",
        pending: p.pending,
        dead: p.dead,
      };
    return p;
  });

  if (!state.result) {
    for (const p of state.pieces.filter((x) => x.status === "ready" && x.pending)) {
      const current = state.pieces.find((x) => x.id === p.id)!;
      const { toX, toY } = current.pending!;
      state.pieces = state.pieces.map((x) => (x.id === p.id ? { ...x, pending: undefined } : x));
      startReadyMove(state, { ...current, pending: undefined }, toX, toY);
    }
  }

  if (!state.result && t - state.lastProgressTick >= NO_PROGRESS_TICKS) {
    const live = COLORS[state.variant].filter((c) => !state.out.some((o) => o.color === c));
    state.result = { winner: null, reason: "no_progress", ranking: rankingOf(state, live) };
  }
  if (state.result) state.endTick = t;
  state.tick = t + 1;
}

export function simulate(commands: Command[], toTick: number, from?: State | Variant): State {
  const state: State = typeof from === "object" ? structuredClone(from) : initialState(from ?? "two");
  const sorted = commands.filter((c) => c.tick >= state.tick).sort(commandOrder);
  let i = 0;
  while (state.tick < toTick && !state.result) {
    while (i < sorted.length && sorted[i].tick === state.tick) applyCommand(state, sorted[i++]);
    stepTick(state);
  }
  return state;
}

export function predictEnd(commands: Command[], fromTick: number, variant: Variant = "two"): { tick: number; result: Result } {
  let state = simulate(commands, fromTick, variant);
  while (!state.result) state = simulate(commands, state.tick + NO_PROGRESS_TICKS + 1, state);
  return { tick: state.endTick!, result: state.result };
}

function rankingOf(state: State, live: Color[]): Color[][] {
  const groups: Color[][] = live.length ? [live] : [];
  const byTick = new Map<number, Color[]>();
  for (const o of state.out) byTick.set(o.tick, [...(byTick.get(o.tick) ?? []), o.color]);
  for (const tick of [...byTick.keys()].sort((a, b) => b - a)) groups.push(byTick.get(tick)!);
  return groups;
}
