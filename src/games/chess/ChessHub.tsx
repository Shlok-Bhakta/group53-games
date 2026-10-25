import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "convex/react";
import { motion } from "motion/react";
import { ArrowLeftIcon, LightningIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import { MODES, isMode, modePath, type ModeKey } from "../../../convex/modes";
import { BackHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ModePicker } from "@/components/ModePicker";
import { Inbox } from "./Inbox";

// The chess front door: the mode picker (async first, then real-time), and everything that wants you
// underneath.
export function ChessHub() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const inbox = useQuery(api.matches.inbox);
  const ratings = useQuery(api.ratings.mine);

  // Old links pointed at /chess?mode=...
  const legacy = params.get("mode");
  useEffect(() => {
    if (legacy && isMode(legacy)) navigate(modePath(legacy), { replace: true });
  }, [legacy, navigate]);

  const count = (mode: ModeKey, key: "myTurn" | "live" | "open" | "invites") => inbox?.[key].filter((m) => m.mode === mode).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <BackHeader
        title="Chess"
        back={
          <Button variant="ghost" size="icon" asChild aria-label="Back to games">
            <Link to="/">
              <ArrowLeftIcon size={24} weight="bold" />
            </Link>
          </Button>
        }
      />

      <div className="-mt-3">
        <ModePicker
          game="chess"
          art={(mode) => <ModeArt four={MODES[mode].players > 2} realtime={MODES[mode].kind === "realtime"} />}
          rating={(mode) => (ratings?.[mode]?.games ? ratings[mode].rating : null)}
          badge={(mode) =>
            count(mode, "invites") ? `${count(mode, "invites")} challenge${count(mode, "invites") > 1 ? "s" : ""}`
            : count(mode, "myTurn") ? "Your move"
            : count(mode, "live") ? "Live now"
            : count(mode, "open") ? `${count(mode, "open")} open`
            : null
          }
        />
      </div>

      <Inbox title="Waiting on you" />
    </div>
  );
}

// A tiny board: a 4x4 square for two players, a cross for four, with a spark for real-time.
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
        {dots.map((d) => (
          <circle key={d.c} cx={d.x + 0.5} cy={d.y + 0.5} r={0.36} fill={d.c} stroke="white" strokeWidth={0.08} />
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
          className={cn("absolute -right-2 -top-1 grid size-8 place-items-center rounded-full bg-[var(--tile-yellow)] text-[var(--tile-ink)] shadow")}
          animate={{ rotate: [0, -12, 12, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.2 }}
        >
          <LightningIcon size={18} weight="fill" />
        </motion.span>
      )}
    </span>
  );
}
