import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import { CloudFogIcon } from "@phosphor-icons/react";
import { LENGTH } from "../../../convex/wordle/engine";
import { cn } from "@/lib/utils";
import { MARK_STATE } from "./parts";

export type Row = { letters: string; marks: string } | { fog: true };

const GAP = 6;
const MAX_TILE = 62;
export const FLIP_S = 0.32;
export const FLIP_STAGGER_S = 0.16;

function useTileSize(rows: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(48);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const byW = (width - GAP * (LENGTH - 1)) / LENGTH;
      const byH = (height - GAP * (rows - 1)) / rows;
      setSize(Math.max(20, Math.floor(Math.min(byW, byH, MAX_TILE))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows]);
  return [ref, size] as const;
}

export function Board({
  round,
  rows,
  played,
  typed,
  typing,
  hint,
  shake,
  won,
  fogBy,
  className,
}: {
  round: number;
  rows: number;
  played: Row[];
  typed: string;
  typing: boolean;
  hint: { at: number; letter: string } | null;
  shake: number;
  won: boolean;
  fogBy: string | null;
  className?: string;
}) {
  const [ref, size] = useTileSize(rows);
  const [seen, setSeen] = useState({ round, rows: played.length });
  if (seen.round !== round) setSeen({ round, rows: 0 });
  const seenAtMount = { current: seen.round === round ? seen.rows : 0 };
  const fogRows = played.filter((r) => "fog" in r).length;
  const vars = { "--size": `${size}px`, "--fs": `${Math.round(size * 0.52)}px`, "--r": `${Math.round(size / 7)}px` } as CSSProperties;
  return (
    <div ref={ref} className={cn("relative grid min-h-0 w-full place-items-center", className)}>
      <div
        role="grid"
        aria-label="Your board"
        data-rows={rows}
        data-played={played.length}
        className="relative flex flex-col"
        style={{ ...vars, gap: GAP }}
      >
        {Array.from({ length: rows }, (_, r) => {
          const row = played[r];
          const current = r === played.length && typing;
          return (
            <motion.div
              key={current ? `typing-${shake}` : r}
              role="row"
              data-row={r}
              className="flex"
              style={{ gap: GAP }}
              animate={current && shake ? { x: [0, -10, 10, -7, 7, -3, 0] } : undefined}
              transition={{ duration: 0.4 }}
            >
              {Array.from({ length: LENGTH }, (_, i) => {
                if (row && "letters" in row)
                  return (
                    <Revealed
                      key={i}
                      letter={row.letters[i]}
                      mark={Number(row.marks[i])}
                      i={i}
                      flip={r >= seenAtMount.current}
                      hop={won && r === played.length - 1 && r >= seenAtMount.current}
                    />
                  );
                if (row) return <span key={i} role="gridcell" aria-label="Fogged" className="tile tile-empty" />;
                if (current) return <Typed key={i} letter={typed[i]} hint={hint?.at === i && !typed[i] ? hint.letter : null} />;
                return <span key={i} role="gridcell" aria-label="Empty" className="tile tile-empty" />;
              })}
            </motion.div>
          );
        })}
        {fogRows > 0 && (
          <motion.div
            data-fog={fogRows}
            className="absolute inset-x-[-6px] top-[-6px] flex items-center justify-center gap-2 rounded-lg bg-muted/95 text-callout text-muted-foreground"
            style={{ height: fogRows * (size + GAP) + GAP }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", bounce: 0, duration: 0.5 }}
          >
            <CloudFogIcon size={Math.min(28, size * 0.6)} weight="fill" aria-hidden="true" />
            {fogBy ? `${fogBy}'s fog` : "Fog"}
          </motion.div>
        )}
      </div>
    </div>
  );
}

function Revealed({ letter, mark, i, flip, hop }: { letter: string; mark: number; i: number; flip: boolean; hop: boolean }) {
  const state = MARK_STATE[mark];
  return (
    <motion.span
      role="gridcell"
      aria-label={`${letter.toUpperCase()} ${state === "gray" ? "not in the word" : state === "yellow" ? "elsewhere" : "right"}`}
      data-mark={mark}
      className={cn("tile", `tile-${state}`)}
      initial={flip ? { rotateX: -90 } : false}
      animate={hop ? { rotateX: 0, y: [0, 0, -16, 0] } : { rotateX: 0 }}
      transition={{
        rotateX: { duration: FLIP_S, delay: i * FLIP_STAGGER_S, ease: "easeOut" },
        y: { duration: 0.5, delay: LENGTH * FLIP_STAGGER_S + FLIP_S + i * 0.08, times: [0, 0.1, 0.5, 1] },
      }}
    >
      {letter}
    </motion.span>
  );
}

function Typed({ letter, hint }: { letter: string | undefined; hint: string | null }) {
  if (!letter)
    return (
      <span role="gridcell" aria-label={hint ? `Hint: ${hint.toUpperCase()}` : "Empty"} className="tile tile-empty">
        {hint && <span className="text-[var(--tile-green)] opacity-70">{hint}</span>}
      </span>
    );
  return (
    <motion.span
      key={letter}
      role="gridcell"
      aria-label={letter.toUpperCase()}
      className="tile tile-blank"
      initial={{ scale: 1.14 }}
      animate={{ scale: 1 }}
      transition={{ duration: 0.12 }}
    >
      {letter}
    </motion.span>
  );
}
