import { useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { MatchView } from "../../../convex/matches";
import { MODES, type ModeKey } from "../../../convex/modes";
import { cn } from "@/lib/utils";
import { InviteCard, MatchRow, TurnChip } from "./parts";

// Show this many rows before folding the rest behind "Show more".
const FOLD = 3;

// Every chess game that wants me, across all modes: challenges first, then my moves, live games, and open
// seats. Games waiting on someone else fold away underneath.
export function Inbox({ className }: { className?: string }) {
  const inbox = useQuery(api.matches.inbox);
  const me = useQuery(api.users.me);
  const [expanded, setExpanded] = useState(false);
  if (!inbox) return null;
  const meId = me?._id;

  const urgent: { match: MatchView; status: React.ReactNode }[] = [
    ...inbox.myTurn.map((m) => ({ match: m, status: <TurnChip match={m} meId={meId} /> })),
    ...inbox.live.map((m) => ({ match: m, status: <TurnChip match={m} meId={meId} /> })),
    ...inbox.open.map((m) => ({ match: m, status: <span className="text-sm font-semibold text-primary">Join</span> })),
  ];
  const quiet: { match: MatchView; status: React.ReactNode }[] = [
    ...inbox.waiting.map((m) => ({ match: m, status: <span className="text-sm text-muted-foreground">{seatsText(m)}</span> })),
    ...inbox.theirTurn.map((m) => ({ match: m, status: <TurnChip match={m} meId={meId} /> })),
  ];
  const rows = [...urgent, ...quiet];
  if (inbox.invites.length === 0 && rows.length === 0) return null;
  const fold = Math.max(FOLD, urgent.length);
  const shown = expanded ? rows : rows.slice(0, fold);
  const hidden = rows.length - shown.length;

  return (
    <div className={cn("flex flex-col gap-2.5", className)} aria-label="Chess inbox">
      <AnimatePresence initial={false}>
        {inbox.invites.map((m) => (
          <InviteCard key={m._id} match={m} />
        ))}
      </AnimatePresence>
      {rows.length > 0 && (
        <motion.div layout className="divide-y overflow-hidden rounded-2xl border bg-card">
          <AnimatePresence initial={false}>
            {shown.map(({ match, status }) => (
              <motion.div key={match._id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <MatchRow match={match} meId={meId} status={status} showMode />
              </motion.div>
            ))}
          </AnimatePresence>
          {(hidden > 0 || expanded) && rows.length > fold && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="flex min-h-12 w-full touch-manipulation items-center justify-center gap-1.5 text-sm font-semibold text-muted-foreground active:bg-muted"
              aria-expanded={expanded}
            >
              {expanded ? "Show less" : `${hidden} more game${hidden > 1 ? "s" : ""}`}
              <CaretDownIcon weight="bold" className={cn("transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}

function seatsText(m: MatchView) {
  const seats = MODES[m.mode as ModeKey]?.players ?? 2;
  if (seats === 2) return m.invited.length ? "Sent" : "Waiting";
  return `${m.players.length}/${seats}`;
}
