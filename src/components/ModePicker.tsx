import type { ReactNode } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { HourglassMediumIcon, LightningIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { MODES, MODE_KEYS, modePath, type ModeKey } from "../../convex/modes";
import { cn } from "@/lib/utils";

const KINDS = {
  async: { title: "Async", icon: <HourglassMediumIcon weight="fill" /> },
  realtime: { title: "Real-time", icon: <LightningIcon weight="fill" /> },
} as const;
const KIND_ORDER = ["async", "realtime"] as const;

// "1v1", "4-Player", "2–8": the section heading already says async or real-time.
export const seatLabel = (mode: ModeKey) => {
  const m = MODES[mode];
  if (m.minPlayers < m.players) return `${m.minPlayers}–${m.players}`;
  return m.players === 2 ? "1v1" : `${m.players}-Player`;
};

type Props = {
  game: string;
  art: (mode: ModeKey) => ReactNode;
  badge?: (mode: ModeKey) => string | null;
  // My rating in the mode, and whether I've played it.
  rating?: (mode: ModeKey) => { rating: number; games: number } | null;
};

// A game's modes, grouped by kind: a heading per kind, then a row of mode cards with my Elo on each. The
// row scrolls sideways when a kind has more than two modes. A game with one mode of each kind shows them side
// by side, each card naming its kind. Shared by every game.
export function ModePicker({ game, art, badge, rating }: Props) {
  const groups = KIND_ORDER.map((kind) => ({ kind, modes: MODE_KEYS.filter((m) => MODES[m].game === game && MODES[m].kind === kind) })).filter((g) => g.modes.length);
  if (groups.every((g) => g.modes.length === 1)) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {groups.map(({ kind, modes: [mode] }, i) => (
          <motion.section
            key={kind}
            aria-label={KINDS[kind].title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.45, delay: i * 0.05 }}
          >
            <ModeCard mode={mode} art={art(mode)} badge={badge?.(mode) ?? null} rating={rating?.(mode) ?? null} named />
          </motion.section>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ kind, modes }, gi) => {
        // Modes that seat the same can't be told apart by seats, so every card in the row says its name.
        const titled = new Set(modes.map(seatLabel)).size < modes.length;
        return (
          <section key={kind} aria-label={KINDS[kind].title} className="flex flex-col gap-2.5">
            <h2 className="flex items-center gap-2 px-1 font-display text-heading [&_svg]:size-[18px] [&_svg]:text-primary">
              {KINDS[kind].icon}
              {KINDS[kind].title}
            </h2>
            <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none]">
              {modes.map((mode, i) => (
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", bounce: 0, duration: 0.45, delay: (gi * 2 + i) * 0.05 }}
                  className="w-[calc(50%-6px)] shrink-0 snap-start"
                >
                  <ModeCard mode={mode} art={art(mode)} badge={badge?.(mode) ?? null} rating={rating?.(mode) ?? null} titled={titled} />
                </motion.div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// `named` cards say their kind (async or real-time); `titled` ones their mode's name, for rows where seat
// counts don't tell the modes apart (poker's games).
function ModeCard({ mode, art, badge, rating, named, titled }: { mode: ModeKey; art: ReactNode; badge: string | null; rating: { rating: number; games: number } | null; named?: boolean; titled?: boolean }) {
  const m = MODES[mode];
  return (
    <Link
      to={modePath(mode)}
      className="relative flex min-h-44 flex-col gap-2 overflow-hidden rounded-lg bg-card p-3.5 transition-[transform,background-color] duration-100 ease-out active:scale-[0.97] active:bg-muted"
      aria-label={titled ? m.name : `${KINDS[m.kind].title} ${seatLabel(mode)}`}
      data-mode={mode}
    >
      {art}
      {titled ? (
        <span className="mt-auto flex flex-col gap-0.5">
          <span className="truncate font-display text-heading">{m.name}</span>
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-footnote text-muted-foreground">
              <UsersThreeIcon size={14} weight="fill" aria-hidden="true" />
              {seatLabel(mode)}
            </span>
            {rating && (
              <span className={cn("font-display text-body tabular-nums", rating.games === 0 && "text-muted-foreground")} aria-label={`Your rating ${rating.rating}`}>
                {rating.rating}
              </span>
            )}
          </span>
        </span>
      ) : named ? (
        <span className="mt-auto flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-display text-heading [&_svg]:size-[18px] [&_svg]:text-primary">
            {KINDS[m.kind].icon}
            {KINDS[m.kind].title}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-footnote text-muted-foreground">
              <UsersThreeIcon size={14} weight="fill" aria-hidden="true" />
              {seatLabel(mode)}
            </span>
            {rating && (
              <span className={cn("font-display text-body tabular-nums", rating.games === 0 && "text-muted-foreground")} aria-label={`Your rating ${rating.rating}`}>
                {rating.rating}
              </span>
            )}
          </span>
        </span>
      ) : (
        <span className="mt-auto flex items-end justify-between gap-2">
          <span className="font-display text-heading">{seatLabel(mode)}</span>
          {rating && (
            <span className={cn("font-display text-heading tabular-nums", rating.games === 0 && "text-muted-foreground")} aria-label={`Your rating ${rating.rating}`}>
              {rating.rating}
            </span>
          )}
        </span>
      )}
      {badge && (
        <motion.span
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.35 }}
          className="absolute right-2.5 top-2.5 rounded-full bg-primary px-2 py-0.5 text-footnote font-bold text-primary-foreground"
        >
          {badge}
        </motion.span>
      )}
    </Link>
  );
}
