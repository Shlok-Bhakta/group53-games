import { useRef, type MouseEvent } from "react";
import { motion } from "motion/react";
import { ANY_PORT, DESERT, TERRAIN_NAMES, geometryOf, pips } from "../../../convex/hexhaven/board";
import type { HexState } from "../../../convex/hexhaven/engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHold } from "./hold";
import type { Topic } from "./InfoSheet";
import { PALETTE, RESOURCE_INK, TERRAIN, TERRAIN_DEEP } from "./palette";

const SQ = Math.sqrt(3) / 2;
const PAD = 0.8;
const X = (x: number) => x * SQ;
const Y = (y: number) => y / 2;

export type PickKind = "village" | "town" | "road" | "hex";
export type Pick = { kind: PickKind; spots: number[] };

type View = { x: number; y: number; side: number };

function viewOf(state: HexState): View {
  const g = geometryOf(state.layout);
  const xs = g.verts.map((v) => X(v.x));
  const ys = g.verts.map((v) => Y(v.y));
  const minX = Math.min(...xs) - PAD;
  const maxX = Math.max(...xs) + PAD;
  const minY = Math.min(...ys) - PAD;
  const maxY = Math.max(...ys) + PAD;
  const side = Math.max(maxX - minX, maxY - minY);
  return { x: (minX + maxX) / 2 - side / 2, y: (minY + maxY) / 2 - side / 2, side };
}

const PORT_OUT = 0.5;
const PORT_HIT = 0.42;
const HEX_HIT = 1;

function portSpot(state: HexState, k: number) {
  const g = geometryOf(state.layout);
  const edge = g.edges[state.ports[k].e];
  const a = { x: X(g.verts[edge.a].x), y: Y(g.verts[edge.a].y) };
  const b = { x: X(g.verts[edge.b].x), y: Y(g.verts[edge.b].y) };
  const c = { x: X(g.hexes[edge.hexes[0]].x), y: Y(g.hexes[edge.hexes[0]].y) };
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(mx - c.x, my - c.y);
  return { a, b, x: mx + ((mx - c.x) / len) * PORT_OUT, y: my + ((my - c.y) / len) * PORT_OUT };
}

function topicAt(state: HexState, x: number, y: number): Topic | null {
  const g = geometryOf(state.layout);
  const port = state.ports.findIndex((_, k) => {
    const p = portSpot(state, k);
    return Math.hypot(p.x - x, p.y - y) < PORT_HIT;
  });
  if (port >= 0) return { k: "port", i: port };
  let best = -1;
  let bestD = HEX_HIT;
  g.hexes.forEach((h, i) => {
    const d = Math.hypot(X(h.x) - x, Y(h.y) - y);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best >= 0 ? { k: "hex", i: best } : null;
}

const pct = (v: number, from: number, side: number) => `${((v - from) / side) * 100}%`;

export function Glyph({ r }: { r: number }) {
  const fill = r === DESERT ? PALETTE.desertDeep : TERRAIN_DEEP[r];
  switch (r) {
    case 0:
      return <path d="M-.38 .2 L-.17 -.3 L.04 .2Z M-.06 .2 L.16 -.36 L.38 .2Z" fill={fill} />;
    case 1:
      return <path d="M-.36 -.1 h.34 v.14 h-.34Z M.04 -.1 h.34 v.14 h-.34Z M-.17 .08 h.34 v.14 h-.34Z" fill={fill} />;
    case 2:
      return (
        <g fill={fill}>
          <circle cx="-.16" cy="0" r=".13" />
          <circle cx=".02" cy="-.06" r=".15" />
          <circle cx=".18" cy=".02" r=".12" />
        </g>
      );
    case 3:
      return (
        <g stroke={fill} strokeWidth=".06" strokeLinecap="round" fill={fill}>
          {[-0.2, 0, 0.2].map((x) => (
            <g key={x}>
              <line x1={x} y1=".22" x2={x} y2="-.12" />
              <ellipse cx={x} cy="-.2" rx=".05" ry=".11" stroke="none" />
            </g>
          ))}
        </g>
      );
    case 4:
      return <path d="M-.42 .2 L-.12 -.3 L.06 -.02 L.18 -.18 L.42 .2Z" fill={fill} />;
    default:
      return <path d="M-.4 .12 Q-.2 -.08 0 .1 T.4 .06" stroke={fill} strokeWidth=".07" fill="none" strokeLinecap="round" />;
  }
}

const VILLAGE = "M-.17 .13 V-.05 L0 -.21 L.17 -.05 V.13Z";
const TOWN = "M-.26 .16 V-.05 L-.12 -.18 L.02 -.05 V-.09 H.26 V.16Z";

export function Board({
  state,
  colors,
  pick,
  chosen,
  onChoose,
  ghostColor,
  onInspect,
}: {
  state: HexState;
  colors: string[];
  pick?: Pick | null;
  chosen?: number | null;
  onChoose?: (i: number) => void;
  ghostColor?: string;
  onInspect?: (topic: Topic) => void;
}) {
  const g = geometryOf(state.layout);
  const view = viewOf(state);
  const root = useRef<HTMLDivElement>(null);
  const inspectAt = (cx: number, cy: number) => {
    const box = root.current?.getBoundingClientRect();
    if (!box || !onInspect) return;
    const topic = topicAt(state, view.x + ((cx - box.left) / box.width) * view.side, view.y + ((cy - box.top) / box.height) * view.side);
    if (topic) onInspect(topic);
  };
  const hold = useHold(inspectAt);
  const tap = (e: MouseEvent) => {
    if (!pick) inspectAt(e.clientX, e.clientY);
  };
  const first = useRef<Set<string> | null>(null);
  const keys = [
    ...state.roads.flatMap((s, e) => (s >= 0 ? [`r${e}`] : [])),
    ...state.spots.flatMap((s, v) => (s ? [`${s.town ? "t" : "v"}${v}`] : [])),
  ];
  first.current ??= new Set(keys);
  const appear = (key: string) => (first.current!.has(key) ? false : { scale: 0, opacity: 0 });
  const vert = (v: number) => ({ x: X(g.verts[v].x), y: Y(g.verts[v].y) });
  const hexAt = (h: number) => ({ x: X(g.hexes[h].x), y: Y(g.hexes[h].y) });
  const at = (kind: PickKind, i: number) => {
    if (kind === "hex") return hexAt(i);
    if (kind === "road") {
      const a = vert(g.edges[i].a);
      const b = vert(g.edges[i].b);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    return vert(i);
  };
  const banditAt = hexAt(state.bandit);
  const pop = { type: "spring", bounce: 0.4, duration: 0.45 } as const;
  const origin = { transformBox: "fill-box", transformOrigin: "center" } as const;

  return (
    <div
      ref={root}
      className="relative aspect-square w-full select-none [-webkit-touch-callout:none]"
      {...(onInspect ? { ...hold, onClick: tap } : {})}
      data-pieces={keys.length}
      data-bandit-at={state.bandit}
      role="group"
      aria-label="The island"
    >
      <svg viewBox={`${view.x} ${view.y} ${view.side} ${view.side}`} className="absolute inset-0 size-full" aria-hidden="true">
        <rect x={view.x} y={view.y} width={view.side} height={view.side} rx={0.5} fill={PALETTE.sea} />
        <polygon
          points={g.coast
            .map((e) => {
              const p = vert(g.edges[e].a);
              return `${p.x},${p.y}`;
            })
            .join(" ")}
          fill={PALETTE.sand}
          stroke={PALETTE.sand}
          strokeWidth={0.35}
          strokeLinejoin="round"
        />
        {state.ports.map((port, k) => {
          const { a, b, x: px, y: py } = portSpot(state, k);
          const any = port.r === ANY_PORT;
          return (
            <g key={k} data-port={k}>
              <line x1={a.x} y1={a.y} x2={px} y2={py} stroke={PALETTE.pier} strokeWidth={0.07} />
              <line x1={b.x} y1={b.y} x2={px} y2={py} stroke={PALETTE.pier} strokeWidth={0.07} />
              <circle cx={px} cy={py} r={0.27} fill={any ? PALETTE.port : TERRAIN[port.r]} stroke={PALETTE.pier} strokeWidth={0.04} />
              <text
                x={px}
                y={py + 0.07}
                textAnchor="middle"
                fontSize={0.2}
                fontWeight={800}
                fill={any ? PALETTE.portInk : RESOURCE_INK[port.r]}
              >
                {any ? "3:1" : "2:1"}
              </text>
            </g>
          );
        })}
        {state.hexes.map((h, i) => {
          const c = hexAt(i);
          const desert = h.r === DESERT;
          const hot = h.n === 6 || h.n === 8;
          return (
            <g key={i} data-hex={i}>
              <polygon
                points={g.hexVerts[i]
                  .map((v) => {
                    const p = vert(v);
                    return `${p.x},${p.y}`;
                  })
                  .join(" ")}
                fill={desert ? PALETTE.desert : TERRAIN[h.r]}
                stroke={PALETTE.sand}
                strokeWidth={0.06}
              />
              <g transform={`translate(${c.x} ${c.y - 0.56}) scale(.9)`}>
                <Glyph r={h.r} />
              </g>
              {h.n > 0 && (
                <g>
                  <circle cx={c.x} cy={c.y + 0.08} r={0.33} fill={PALETTE.token} stroke={PALETTE.tokenEdge} strokeWidth={0.03} />
                  <text
                    x={c.x}
                    y={c.y + 0.16}
                    textAnchor="middle"
                    fontSize={0.3}
                    fontWeight={800}
                    fill={hot ? PALETTE.hot : PALETTE.tokenInk}
                  >
                    {h.n}
                  </text>
                  <g fill={hot ? PALETTE.hot : PALETTE.tokenInk}>
                    {Array.from({ length: pips(h.n) }, (_, k) => (
                      <circle key={k} cx={c.x + (k - (pips(h.n) - 1) / 2) * 0.07} cy={c.y + 0.28} r={0.022} />
                    ))}
                  </g>
                </g>
              )}
            </g>
          );
        })}
        <motion.g
          initial={false}
          animate={{ x: banditAt.x - 0.46, y: banditAt.y + 0.12 }}
          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
        >
          <g data-bandit={state.bandit}>
            <circle cx={0} cy={-0.2} r={0.11} fill={PALETTE.bandit} stroke={PALETTE.banditEdge} strokeWidth={0.03} />
            <path d="M-.15 .2 Q-.14 -.08 0 -.1 Q.14 -.08 .15 .2Z" fill={PALETTE.bandit} stroke={PALETTE.banditEdge} strokeWidth={0.03} />
          </g>
        </motion.g>
        {state.roads.map((seat, e) => {
          if (seat < 0) return null;
          const a = vert(g.edges[e].a);
          const b = vert(g.edges[e].b);
          const ax = a.x + (b.x - a.x) * 0.16;
          const ay = a.y + (b.y - a.y) * 0.16;
          const bx = b.x + (a.x - b.x) * 0.16;
          const by = b.y + (a.y - b.y) * 0.16;
          return (
            <motion.g key={`r${e}`} initial={appear(`r${e}`)} animate={{ scale: 1, opacity: 1 }} transition={pop} style={origin}>
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke={PALETTE.pieceEdge} strokeWidth={0.2} strokeLinecap="round" />
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke={colors[seat]} strokeWidth={0.13} strokeLinecap="round" />
            </motion.g>
          );
        })}
        {state.spots.map((s, v) => {
          if (!s) return null;
          const p = vert(v);
          const key = `${s.town ? "t" : "v"}${v}`;
          return (
            <g key={key} transform={`translate(${p.x} ${p.y})`}>
              <motion.path
                d={s.town ? TOWN : VILLAGE}
                fill={colors[s.seat]}
                stroke={PALETTE.pieceEdge}
                strokeWidth={0.04}
                strokeLinejoin="round"
                initial={appear(key)}
                animate={{ scale: 1, opacity: 1 }}
                transition={pop}
                style={origin}
              />
            </g>
          );
        })}
        {pick && chosen !== null && chosen !== undefined && ghostColor && (
          <Ghost kind={pick.kind} at={at(pick.kind, chosen)} color={ghostColor} />
        )}
      </svg>
      {pick?.spots.map((i) => {
        const p = at(pick.kind, i);
        const on = chosen === i;
        return (
          <Button
            key={`${pick.kind}${i}`}
            variant="bare"
            size="overlay"
            aria-label={labelOf(pick.kind, i, state)}
            aria-pressed={on}
            data-pick={pick.kind}
            data-at={i}
            onClick={() => onChoose?.(i)}
            className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
            style={{ left: pct(p.x, view.x, view.side), top: pct(p.y, view.y, view.side) }}
          >
            <span
              className={cn("block rounded-full border-2 transition-transform duration-150", on ? "size-5" : "size-3.5")}
              style={{ background: PALETTE.spot, borderColor: PALETTE.spotRing, opacity: on ? 1 : 0.85 }}
            />
          </Button>
        );
      })}
    </div>
  );
}

function Ghost({ kind, at, color }: { kind: PickKind; at: { x: number; y: number }; color: string }) {
  if (kind === "hex")
    return <circle cx={at.x} cy={at.y + 0.08} r={0.5} fill="none" stroke={PALETTE.spot} strokeWidth={0.07} strokeDasharray=".12 .08" />;
  if (kind === "road") return <circle cx={at.x} cy={at.y} r={0.16} fill={color} stroke={PALETTE.spot} strokeWidth={0.05} />;
  return (
    <path
      d={kind === "town" ? TOWN : VILLAGE}
      transform={`translate(${at.x} ${at.y})`}
      fill={color}
      stroke={PALETTE.spot}
      strokeWidth={0.05}
      opacity={0.85}
    />
  );
}

function labelOf(kind: PickKind, i: number, state: HexState) {
  if (kind === "hex") {
    const h = state.hexes[i];
    return h.r === DESERT ? "Desert" : `${TERRAIN_NAMES[h.r]} ${h.n}`;
  }
  return kind === "road" ? `Road spot ${i}` : kind === "town" ? `City on settlement ${i}` : `Settlement spot ${i}`;
}
