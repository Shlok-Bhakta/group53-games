export const RESOURCES = ["timber", "brick", "wool", "grain", "ore"] as const;
export type Resource = (typeof RESOURCES)[number];
export const DESERT = -1;
export const ANY_PORT = -1;

export const TERRAIN_NAMES = ["Forest", "Hills", "Pasture", "Fields", "Mountains"] as const;
export const RESOURCE_NAMES = ["Timber", "Brick", "Wool", "Grain", "Ore"] as const;

export type Hand = number[];
export const noHand = (): Hand => [0, 0, 0, 0, 0];

export const COSTS = {
  road: [1, 1, 0, 0, 0],
  village: [1, 1, 1, 1, 0],
  town: [0, 0, 0, 2, 3],
  card: [0, 0, 1, 1, 1],
} as const satisfies Record<string, Hand>;
export type Piece = keyof typeof COSTS;

export const PIECES = { road: 15, village: 5, town: 4 } as const;

export type Layout = {
  rows: number[];
  terrain: number[];
  numbers: number[];
  ports: number[];
  supply: number;
  deck: { knight: number; roads: number; plenty: number; corner: number; point: number };
};

export const LAYOUTS = {
  standard: {
    rows: [3, 4, 5, 4, 3],
    terrain: [4, 3, 4, 4, 3],
    numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    ports: [ANY_PORT, ANY_PORT, ANY_PORT, ANY_PORT, 0, 1, 2, 3, 4],
    supply: 19,
    deck: { knight: 14, roads: 2, plenty: 2, corner: 2, point: 5 },
  },
  big: {
    rows: [3, 4, 5, 6, 5, 4, 3],
    terrain: [6, 5, 6, 6, 5],
    numbers: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
    ports: [ANY_PORT, ANY_PORT, ANY_PORT, ANY_PORT, ANY_PORT, 0, 1, 2, 2, 3, 4],
    supply: 24,
    deck: { knight: 20, roads: 3, plenty: 3, corner: 3, point: 5 },
  },
} as const satisfies Record<string, Layout>;
export type LayoutKey = keyof typeof LAYOUTS;

export type Point = { x: number; y: number };
export type Geometry = {
  hexes: Point[];
  verts: (Point & { hexes: number[]; edges: number[]; near: number[] })[];
  edges: { a: number; b: number; hexes: number[] }[];
  hexVerts: number[][];
  hexNear: number[][];
  coast: number[];
  portSlots: number[];
  width: number;
  height: number;
};

const CORNERS: Point[] = [
  { x: 0, y: -2 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: 0, y: 2 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

function build(layout: Layout): Geometry {
  const hexes: Point[] = [];
  const mid = Math.floor(layout.rows.length / 2);
  layout.rows.forEach((len, row) => {
    for (let i = 0; i < len; i++) hexes.push({ x: 2 * i - (len - 1), y: 3 * (row - mid) });
  });
  const verts: Geometry["verts"] = [];
  const vertAt = new Map<string, number>();
  const edges: Geometry["edges"] = [];
  const edgeAt = new Map<string, number>();
  const hexVerts = hexes.map((h, hi) =>
    CORNERS.map((c) => {
      const p = { x: h.x + c.x, y: h.y + c.y };
      const key = `${p.x},${p.y}`;
      let v = vertAt.get(key);
      if (v === undefined) {
        v = verts.length;
        vertAt.set(key, v);
        verts.push({ ...p, hexes: [], edges: [], near: [] });
      }
      verts[v].hexes.push(hi);
      return v;
    }),
  );
  hexVerts.forEach((vs, hi) =>
    vs.forEach((a, k) => {
      const b = vs[(k + 1) % 6];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      let e = edgeAt.get(key);
      if (e === undefined) {
        e = edges.length;
        edgeAt.set(key, e);
        edges.push({ a: Math.min(a, b), b: Math.max(a, b), hexes: [] });
        verts[a].edges.push(e);
        verts[b].edges.push(e);
        verts[a].near.push(b);
        verts[b].near.push(a);
      }
      edges[e].hexes.push(hi);
    }),
  );
  const hexNear = hexes.map((h) =>
    hexes.flatMap((o, j) => {
      const dx = Math.abs(o.x - h.x);
      const dy = Math.abs(o.y - h.y);
      return (dx === 2 && dy === 0) || (dx === 1 && dy === 3) ? [j] : [];
    }),
  );
  const coastal = new Set(edges.flatMap((e, i) => (e.hexes.length === 1 ? [i] : [])));
  const topLeft = [...coastal].sort((i, j) => {
    const a = edges[i];
    const b = edges[j];
    const ay = verts[a.a].y + verts[a.b].y;
    const by = verts[b.a].y + verts[b.b].y;
    return ay - by || verts[a.a].x + verts[a.b].x - (verts[b.a].x + verts[b.b].x);
  })[0];
  const coast = [topLeft];
  let at = verts[edges[topLeft].a].x > verts[edges[topLeft].b].x ? edges[topLeft].a : edges[topLeft].b;
  while (coast.length < coastal.size) {
    const next = verts[at].edges.find((e) => coastal.has(e) && !coast.includes(e))!;
    coast.push(next);
    at = edges[next].a === at ? edges[next].b : edges[next].a;
  }
  const portSlots = layout.ports.map((_, i) => coast[Math.round((i * coast.length) / layout.ports.length)]);
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  return {
    hexes,
    verts,
    edges,
    hexVerts,
    hexNear,
    coast,
    portSlots,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

const built = new Map<LayoutKey, Geometry>();
export function geometryOf(layout: LayoutKey): Geometry {
  let g = built.get(layout);
  if (!g) {
    g = build(LAYOUTS[layout]);
    built.set(layout, g);
  }
  return g;
}

export const pips = (n: number) => (n === 0 ? 0 : 6 - Math.abs(7 - n));
