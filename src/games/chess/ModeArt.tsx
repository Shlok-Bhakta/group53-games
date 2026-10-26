import { motion } from "motion/react";
import { LightningIcon } from "@phosphor-icons/react";
import { MODES, type ModeKey } from "../../../convex/modes";

export const ChessModeArt = ({ mode }: { mode: ModeKey }) => <ModeArt four={MODES[mode].players > 2} realtime={MODES[mode].kind === "realtime"} />;

// A tiny board: a 4x4 square for two players, a cross for four, with a spark for real-time that jolts once.
function ModeArt({ four, realtime }: { four: boolean; realtime: boolean }) {
  const n = four ? 6 : 4;
  const cells = Array.from({ length: n * n }, (_, i) => [i % n, Math.floor(i / n)] as const);
  const cut = (x: number, y: number) => four && (x === 0 || x === n - 1) && (y === 0 || y === n - 1);
  const dots = four
    ? [
        { x: 2.5, y: 5, c: "#e0503f" },
        { x: 0, y: 2.5, c: "#3f7be0" },
        { x: 2.5, y: 0, c: "#e8b928" },
        { x: 5, y: 2.5, c: "#3faa5a" },
      ]
    : [];
  return (
    <span className="relative block size-20" aria-hidden="true">
      <svg viewBox={`0 0 ${n} ${n}`} className="size-full overflow-visible">
        {cells.map(([x, y]) =>
          cut(x, y) ? null : <rect key={`${x}${y}`} x={x} y={y} width={1} height={1} className={(x + y) % 2 ? "fill-[var(--board-dark)]" : "fill-[var(--board-light)]"} />,
        )}
        {dots.map((d, i) => (
          <motion.circle
            key={d.c}
            cx={d.x + 0.5}
            cy={d.y + 0.5}
            r={0.36}
            fill={d.c}
            stroke="white"
            strokeWidth={0.08}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.4, duration: 0.4, delay: 0.15 + i * 0.06 }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
        ))}
        {!four && (
          <>
            <circle cx={1.5} cy={3.5} r={0.36} fill="white" stroke="black" strokeWidth={0.08} />
            <circle cx={2.5} cy={0.5} r={0.36} fill="black" stroke="white" strokeWidth={0.08} />
          </>
        )}
      </svg>
      {realtime && (
        <motion.span
          className="absolute -right-2 -top-1 grid size-8 place-items-center rounded-full bg-[var(--tile-yellow)] text-[var(--tile-yellow-ink)] shadow"
          initial={{ scale: 0.6, rotate: -30, opacity: 0 }}
          animate={{ scale: [0.6, 1.15, 1], rotate: [-30, 12, 0], opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <LightningIcon size={18} weight="fill" />
        </motion.span>
      )}
    </span>
  );
}
