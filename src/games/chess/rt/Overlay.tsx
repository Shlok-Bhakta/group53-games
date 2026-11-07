import { AnimatePresence, motion } from "motion/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { RealtimeState } from "../../../../convex/chess";
import type { MatchView } from "../../../../convex/matches";
import { listNames } from "@/lib/text";

// Over the board before play starts: who it's waiting for, then the countdown.
export function Overlay({ match, state, meId, countdown }: { match: MatchView; state: RealtimeState; meId: Id<"users"> | undefined; countdown: number | null }) {
  const waitingFor = match.players.filter((p) => !state.ready.includes(p.userId) && p.userId !== meId);
  const show = match.status === "active" && (state.startAt === null || countdown !== null);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-sm bg-background/55 backdrop-blur-[2px]"
        >
          {state.startAt === null ? (
            <p className="max-w-[24ch] text-center font-display text-heading">
              {waitingFor.length ? `Waiting for ${listNames(waitingFor.map((p) => p.name))} to open the board` : "Starting…"}
            </p>
          ) : (
            <AnimatePresence mode="popLayout">
              <motion.span
                key={countdown}
                initial={{ scale: 1.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className="font-display text-title-lg text-foreground drop-shadow"
              >
                {/* Twice the biggest title, scaled so the type stays on the scale. */}
                <span className="block scale-200">{countdown}</span>
              </motion.span>
            </AnimatePresence>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
