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

const SECTIONS: { title: string; blurb: string; icon: React.ReactNode; modes: ModeKey[] }[] = [
  { title: "Async", blurb: "Take turns over the day. We ping you when it's your move.", icon: <HourglassMediumIcon weight="fill" />, modes: ["chess:classic", "chess:four"] },
  { title: "Real-time", blurb: "Everyone on the board at once. No turns, just speed.", icon: <LightningIcon weight="fill" />, modes: ["chess:realtime", "chess:realtime4"] },
];

// The chess front door: async modes first, real-time below, each its own panel with a row of modes that
// scrolls sideways once there are more than two. Everything that wants you sits underneath.
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

      <div className="-mt-3 flex flex-col gap-4">
        {SECTIONS.map((sec, si) => (
          <motion.section
            key={sec.title}
            aria-label={sec.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28, delay: si * 0.06 }}
            className="rounded-[28px] border bg-muted/40 py-3.5"
          >
            <header className="flex items-center gap-2.5 px-4 pb-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground [&_svg]:size-[18px]">{sec.icon}</span>
              <span className="min-w-0">
                <h2 className="font-display text-xl leading-tight">{sec.title}</h2>
                <p className="text-sm leading-snug text-muted-foreground">{sec.blurb}</p>
              </span>
            </header>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-3.5 px-3.5 pb-0.5 [scrollbar-width:none]">
              {sec.modes.map((mode, i) => (
                <div key={mode} className="w-[calc(50%-6px)] shrink-0 snap-start">
                  <ModeTile
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
                </div>
              ))}
            </div>
          </motion.section>
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
        className="relative flex min-h-44 flex-col gap-2 overflow-hidden rounded-3xl border bg-card p-3.5 shadow-sm active:scale-[0.98] active:bg-muted"
        aria-label={`${m.kind === "realtime" ? "Real-time" : "Async"} ${four ? "4-Player" : "1v1"}`}
      >
        <ModeArt four={four} realtime={m.kind === "realtime"} />
        <span className="mt-auto">
          <span className="block font-display text-lg leading-tight">{four ? "4-Player" : "1v1"}</span>
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
