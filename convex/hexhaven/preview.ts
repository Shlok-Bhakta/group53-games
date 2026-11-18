import type { PreviewBoard } from "../previews";
import { geometryOf } from "./board";
import { actor, publicPoints, type HexState } from "./engine";

const SQ = Math.sqrt(3) / 2;
const round = (n: number) => Math.round(n * 1000) / 1000;

function drawing(st: HexState) {
  const g = geometryOf(st.layout);
  const at = (p: { x: number; y: number }) => [round(p.x * SQ), round(p.y / 2)];
  return {
    hexes: st.hexes.map((h, i) => ({ c: at(g.hexes[i]), r: h.r, n: h.n, corners: g.hexVerts[i].map((v) => at(g.verts[v])) })),
    spots: st.spots.flatMap((s, v) => (s ? [{ c: at(g.verts[v]), seat: s.seat, town: s.town }] : [])),
    roads: st.roads.flatMap((seat, e) => (seat >= 0 ? [{ a: at(g.verts[g.edges[e].a]), b: at(g.verts[g.edges[e].b]), seat }] : [])),
    bandit: at(g.hexes[st.bandit]),
  };
}

export const hexhavenPreview: PreviewBoard = async (_ctx, m, players) => {
  const st = m.state as HexState | null;
  return {
    seats: m.players.length,
    points: null,
    board: [],
    toMove: m.status === "active" && st && st.phase.k !== "over" ? (players[actor(st)]?.color ?? null) : null,
    hexhaven: st
      ? {
          goal: st.rules.points,
          turn: st.turn,
          setup: st.phase.k === "setup",
          points: st.players.map((p, i) => p.points ?? publicPoints(st, i)),
          out: st.players.map((p) => p.out),
          ...drawing(st),
        }
      : null,
  };
};
