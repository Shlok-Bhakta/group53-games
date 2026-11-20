import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CaretRightIcon, CrownSimpleIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DAILY_GAMES, dailyPath, findDailyGame } from "../../../convex/daily/games";
import { Section } from "@/components/parts";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { cn } from "@/lib/utils";
import { PasteButton } from "./Paste";
import { useFaces } from "./Standings";
import { useToday } from "./today";

const SHOWN = 5;

export function DailyStrip({ meId }: { meId: Id<"users"> | undefined }) {
  const day = useToday();
  const rounds = useQuery(api.daily.today, { day });
  const faces = useFaces();
  const strip = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const newest = rounds?.[0] ? `${rounds[0].game}:${rounds[0].latest}` : null;
  useEffect(() => {
    if (newest) strip.current?.scrollTo({ left: 0, behavior: reduced ? "auto" : "smooth" });
  }, [newest, reduced]);
  if (rounds === undefined) return null;
  return (
    <Section title="Dailies" bare action={<PasteButton size="sm" variant="secondary" className="-mb-1" />}>
      {rounds.length === 0 ? (
        <Link
          to="/daily"
          data-slot="card"
          className="flex min-h-16 items-center gap-3 rounded-lg bg-card px-4 transition-transform duration-100 ease-out active:scale-[0.97]"
        >
          <span className="min-w-0 flex-1 truncate text-callout text-muted-foreground">{DAILY_GAMES.map((g) => g.name).join(", ")}</span>
          <CaretRightIcon weight="bold" className="shrink-0 text-muted-foreground" />
        </Link>
      ) : (
        <div
          ref={strip}
          aria-label="Today's dailies"
          className="bleed-x flex snap-x snap-mandatory scroll-px-[var(--gutter-left)] gap-2.5 overflow-x-auto px-page [scrollbar-width:none]"
        >
          {rounds.map((r) => {
            const game = findDailyGame(r.game);
            if (!game) return null;
            const more = r.entries.length - SHOWN;
            return (
              <Link
                key={r.game}
                to={dailyPath(game.key)}
                data-slot="card"
                data-daily={game.key}
                className={cn(
                  "flex h-[116px] shrink-0 snap-start flex-col justify-between rounded-lg bg-card p-3.5 transition-transform duration-100 ease-out active:scale-[0.97]",
                  rounds.length > 1 ? "w-[86%]" : "w-full",
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-display text-body">
                    {game.name}
                    {r.puzzle !== null && <span className="text-muted-foreground"> #{r.puzzle}</span>}
                  </span>
                  <span className="shrink-0 text-footnote text-muted-foreground tabular-nums">{r.entries.length} in</span>
                </span>
                <span className="flex items-end gap-3">
                  <AnimatePresence initial={false}>
                    {r.entries.slice(0, SHOWN).map((e) => {
                      const face = faces.get(e.userId);
                      return (
                        <motion.span
                          key={e._id}
                          layout="position"
                          initial={{ opacity: 0, scale: 0.6 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ type: "spring", bounce: 0.3, duration: 0.45 }}
                          className="relative flex min-w-11 max-w-18 flex-col items-center gap-1"
                          data-entry={e.userId === meId ? "mine" : "theirs"}
                        >
                          {e.place === 1 && r.entries.length > 1 && (
                            <CrownSimpleIcon
                              weight="fill"
                              aria-label="First"
                              className="absolute -top-2.5 z-10 size-4 text-[var(--tile-yellow)]"
                            />
                          )}
                          <PlayerAvatar player={face} name={face?.name ?? "Player"} size={36} />
                          <span
                            className={cn(
                              "max-w-full truncate text-footnote font-semibold tabular-nums",
                              !e.solved && "text-muted-foreground",
                            )}
                          >
                            {e.display}
                          </span>
                        </motion.span>
                      );
                    })}
                  </AnimatePresence>
                  {more > 0 && <span className="pb-6 text-footnote text-muted-foreground tabular-nums">+{more}</span>}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Section>
  );
}
