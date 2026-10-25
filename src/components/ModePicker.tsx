import type { ReactNode } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { HourglassMediumIcon, LightningIcon, UsersFourIcon, UsersIcon } from "@phosphor-icons/react";
import { MODES, MODE_KEYS, modePath, type ModeKey } from "../../convex/modes";
import { Separator } from "@/components/ui/separator";

// How each kind of mode reads, for every game.
const KINDS = {
  async: { title: "Async", blurb: "Take turns over the day. We ping you when it's your move.", icon: <HourglassMediumIcon weight="fill" /> },
  realtime: { title: "Real-time", blurb: "Everyone on at once. No turns, just speed.", icon: <LightningIcon weight="fill" /> },
} as const;
const KIND_ORDER = ["async", "realtime"] as const;

// "1v1", "4-Player": the section heading already says async or real-time.
export const seatLabel = (mode: ModeKey) => (MODES[mode].players === 2 ? "1v1" : `${MODES[mode].players}-Player`);

type Props = {
  game: string;
  art: (mode: ModeKey) => ReactNode;
  badge?: (mode: ModeKey) => string | null;
  rating?: (mode: ModeKey) => number | null;
};

// A game's modes, grouped by kind: a heading and one line of copy per kind, then a row of mode tiles
// that scrolls sideways when there are more than two. Shared by every game.
export function ModePicker({ game, art, badge, rating }: Props) {
  const groups = KIND_ORDER.map((kind) => ({ kind, modes: MODE_KEYS.filter((m) => MODES[m].game === game && MODES[m].kind === kind) })).filter((g) => g.modes.length);
  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ kind, modes }, gi) => (
        <section key={kind} aria-label={KINDS[kind].title} className="flex flex-col gap-3">
          {gi > 0 && <Separator className="mb-2" />}
          <header className="px-1">
            <h2 className="flex items-center gap-2 font-display text-xl leading-tight [&_svg]:size-[18px] [&_svg]:text-primary">
              {KINDS[kind].icon}
              {KINDS[kind].title}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{KINDS[kind].blurb}</p>
          </header>
          <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none]">
            {modes.map((mode, i) => (
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 26, delay: (gi * 2 + i) * 0.04 }}
                className="w-[calc(50%-6px)] shrink-0 snap-start"
              >
                <ModeTile mode={mode} art={art(mode)} badge={badge?.(mode) ?? null} rating={rating?.(mode) ?? null} />
              </motion.div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ModeTile({ mode, art, badge, rating }: { mode: ModeKey; art: ReactNode; badge: string | null; rating: number | null }) {
  const m = MODES[mode];
  return (
    <Link
      to={modePath(mode)}
      className="relative flex min-h-44 flex-col gap-2 overflow-hidden rounded-3xl border bg-card p-3.5 active:scale-[0.98] active:bg-muted"
      aria-label={`${KINDS[m.kind].title} ${seatLabel(mode)}`}
    >
      {art}
      <span className="mt-auto">
        <span className="block font-display text-lg leading-tight">{seatLabel(mode)}</span>
        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {m.players > 2 ? <UsersFourIcon weight="bold" /> : <UsersIcon weight="bold" />}
          {m.players} players
          {rating !== null && <span className="ml-auto font-semibold tabular-nums text-foreground">{rating}</span>}
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
  );
}
