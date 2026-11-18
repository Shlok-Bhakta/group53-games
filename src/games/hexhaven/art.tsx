import { motion } from "motion/react";
import { Glyph } from "./Board";
import { PALETTE, TERRAIN } from "./palette";

const SQ = Math.sqrt(3) / 2;
const HEX = [0, 1, 2, 3, 4, 5].map((k) => {
  const a = (Math.PI / 3) * k - Math.PI / 2;
  return `${Math.cos(a).toFixed(3)},${Math.sin(a).toFixed(3)}`;
});

const BANNER = [
  { x: -1, y: -1, r: 0, n: 6 },
  { x: 1, y: -1, r: 3, n: 9 },
  { x: -2, y: 0, r: 2, n: 4 },
  { x: 0, y: 0, r: 4, n: 8 },
  { x: 2, y: 0, r: 1, n: 10 },
  { x: -1, y: 1, r: 1, n: 5 },
  { x: 1, y: 1, r: 0, n: 3 },
];

function Tile({ r, n, x, y, delay }: { r: number; n: number; x: number; y: number; delay: number }) {
  const hot = n === 6 || n === 8;
  return (
    <motion.g
      initial={{ opacity: 0, y: y - 1.2 }}
      animate={{ opacity: 1, y }}
      transition={{ type: "spring", bounce: 0.35, duration: 0.5, delay }}
      style={{ x }}
    >
      <polygon points={HEX.join(" ")} fill={TERRAIN[r]} stroke={PALETTE.sand} strokeWidth={0.07} />
      <g transform="translate(0 -.55) scale(.85)">
        <Glyph r={r} />
      </g>
      <circle cy={0.1} r={0.3} fill={PALETTE.token} />
      <text y={0.2} textAnchor="middle" fontSize={0.28} fontWeight={800} fill={hot ? PALETTE.hot : PALETTE.tokenInk}>
        {n}
      </text>
    </motion.g>
  );
}

export function HexhavenBanner() {
  return (
    <div className="mx-auto flex h-[150px] w-full max-w-[320px] items-center justify-center" role="img" aria-label="Hexhaven">
      <svg viewBox="-3.1 -2.6 6.2 5.2" className="h-full">
        <rect x={-3.1} y={-2.6} width={6.2} height={5.2} rx={0.5} fill={PALETTE.sea} />
        {BANNER.map((t, i) => (
          <Tile key={i} r={t.r} n={t.n} x={t.x * SQ} y={t.y * 1.5} delay={i * 0.07} />
        ))}
        <motion.path
          d="M-.17 .13 V-.05 L0 -.21 L.17 -.05 V.13Z"
          fill={PALETTE.hot}
          stroke={PALETTE.pieceEdge}
          strokeWidth={0.04}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1.4 }}
          transition={{ type: "spring", bounce: 0.5, duration: 0.45, delay: 0.7 }}
          style={{ x: 0, y: -1, transformBox: "fill-box", transformOrigin: "center" }}
        />
      </svg>
    </div>
  );
}

export function HexhavenModeArt() {
  return (
    <span className="relative block size-20" aria-hidden="true">
      <svg viewBox="-1.9 -1.9 3.8 3.8" className="size-full">
        {BANNER.slice(2, 5).map((t, i) => (
          <Tile key={i} r={t.r} n={t.n} x={(i - 1) * SQ * 1.15} y={i === 1 ? -0.7 : 0.6} delay={0.1 + i * 0.07} />
        ))}
      </svg>
    </span>
  );
}
