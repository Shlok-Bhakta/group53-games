export const SIZE = 14;
export const COLORS4 = ["red", "blue", "yellow", "green"] as const;
export type Color4 = (typeof COLORS4)[number];
export type Kind = "P" | "N" | "B" | "R" | "Q" | "K";

export const onBoard = (x: number, y: number) => x >= 0 && x < SIZE && y >= 0 && y < SIZE && !((x < 3 || x > 10) && (y < 3 || y > 10));

const TURNS: Record<Color4, number> = { red: 0, blue: 1, yellow: 2, green: 3 };

export function rotate(color: Color4, x: number, y: number): [number, number] {
  let p: [number, number] = [x, y];
  for (let i = 0; i < TURNS[color]; i++) p = [p[1], SIZE - 1 - p[0]];
  return p;
}

export function unrotate(color: Color4, x: number, y: number): [number, number] {
  let p: [number, number] = [x, y];
  for (let i = 0; i < TURNS[color]; i++) p = [SIZE - 1 - p[1], p[0]];
  return p;
}

export function rotateDir(color: Color4, dx: number, dy: number): [number, number] {
  let v: [number, number] = [dx, dy];
  for (let i = 0; i < TURNS[color]; i++) v = [v[1], -v[0]];
  return v;
}

export const BACK_RANK: Kind[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];

export type Setup = { color: Color4; kind: Kind; x: number; y: number };

export function setup(): Setup[] {
  const out: Setup[] = [];
  for (const color of COLORS4) {
    for (let i = 0; i < 8; i++) {
      const [bx, by] = rotate(color, 3 + i, 0);
      out.push({ color, kind: BACK_RANK[i], x: bx, y: by });
    }
    for (let i = 0; i < 8; i++) {
      const [px, py] = rotate(color, 3 + i, 1);
      out.push({ color, kind: "P", x: px, y: py });
    }
  }
  return out;
}

export const forward = (color: Color4) => rotateDir(color, 0, 1);

export const relativeRank = (color: Color4, x: number, y: number) => unrotate(color, x, y)[1];

export const PROMOTION_RANK = 7;
export const promotes = (color: Color4, x: number, y: number) => relativeRank(color, x, y) === PROMOTION_RANK;

export const onPawnStart = (color: Color4, x: number, y: number) => relativeRank(color, x, y) === 1;

export const CASTLES = [
  {
    king: [7, 0],
    kingTo: [9, 0],
    rook: [10, 0],
    rookTo: [8, 0],
    between: [
      [8, 0],
      [9, 0],
    ],
    kingPath: [
      [8, 0],
      [9, 0],
    ],
  },
  {
    king: [7, 0],
    kingTo: [5, 0],
    rook: [3, 0],
    rookTo: [6, 0],
    between: [
      [4, 0],
      [5, 0],
      [6, 0],
    ],
    kingPath: [
      [6, 0],
      [5, 0],
    ],
  },
] as const;

export const POINTS: Record<Kind, number> = { P: 1, N: 3, B: 5, R: 5, Q: 9, K: 20 };

export const FILES14 = "abcdefghijklmn";
export const squareName = (x: number, y: number) => `${FILES14[x]}${y + 1}`;
