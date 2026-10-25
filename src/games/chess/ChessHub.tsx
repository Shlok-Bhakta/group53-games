import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "convex/react";
import { motion } from "motion/react";
import { ArrowLeftIcon, HourglassMediumIcon, LightningIcon, UsersFourIcon, UsersIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import { MODES, isMode, modePath, type ModeKey } from "../../../convex/modes";
import { BackHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Inbox } from "./Inbox";

const COLUMNS: { title: string; icon: React.ReactNode; modes: ModeKey[] }[] = [
  { title: "Async", icon: <HourglassMediumIcon weight="fill" />, modes: ["chess:classic", "chess:four"] },
  { title: "Real-time", icon: <LightningIcon weight="fill" />, modes: ["chess:realtime", "chess:realtime4"] },
];

// The chess front door: async modes on the left, real-time on the right, and everything that wants you
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

      <div className="-mt-3 grid grid-cols-2 gap-3">
        {COLUMNS.map((col) => (
          <section key={col.title} className="flex flex-col gap-3" aria-label={col.title}>
            <h2 className="flex items-center gap-1.5 px-1 text-[13px] font-semibold text-muted-foreground [&_svg]:size-3.5">
              {col.icon}
              {col.title}
            </h2>
            {col.modes.map((mode, i) => (
              <ModeTile
                key={mode}
                mode={mode}
                index={i}
                rating={ratings?.[mode]}
                badge={
                  count(mode, "invites") ? `${count(mode, "invites")} challenge${count(mode, "invites") > 1 ? "s" : ""}`
                  : count(mode, "myTurn") ? "Your move"
                  : count(mode, "live") ? "Live now"
                  : count(mode, "open") ? `${count(mode, "open")} open`
                  : null
                }
              />
            ))}
          </section>
        ))}
      </div>

      <Inbox />
    </div>
  );
}

function ModeTile({ mode, index, rating, badge }: { mode: ModeKey; index: number; rating?: { rating: number; games: number }; badge: string | null }) {
  const m = MODES[mode];
  const four = m.players > 2;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 26, delay: index * 0.05 }}>
      <Link
        to={modePath(mode)}
        className="relative flex min-h-44 flex-col gap-2 overflow-hidden rounded-3xl border bg-card p-3.5 active:scale-[0.98] active:bg-muted"
        aria-label={`${m.kind === "realtime" ? "Real-time" : "Async"} ${m.name}`}
      >
        <ModeArt four={four} realtime={m.kind === "realtime"} />
        <span className="mt-auto">
          <span className="block font-display text-lg leading-tight">{m.name}</span>
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            {four ? <UsersFourIcon weight="bold" /> : <UsersIcon weight="bold" />}
            {m.players} players
            {rating && rating.games > 0 && <span className="ml-auto font-semibold tabular-nums text-foreground">{rating.rating}</span>}
          </span>
        </span>
        {badge && (
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute right-2.5 top-2.5 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground"
          >
            {badge}
          </motion.span>
        )}
      </Link>
    </motion.div>
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
