import { motion } from "motion/react";
import { scoreName } from "../../../convex/golf/engine";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { cn } from "@/lib/utils";

// A sunk hole: what that was called, how the crew's done on it, and on to the next. The ball's already
// back on the tee behind it, for another go. Not a Sheet: it sits inside the stage, inset from the edges and
// rounded all round, where a Sheet is portalled to the bottom edge of the screen.
export function HoleResult({ strokes, par, scores, next, onAgain, onNext }: { strokes: number; par: number; scores: { userId: string; name: string; image: string | null; best: number }[]; next: string | null; onAgain: () => void; onNext: () => void }) {
  const tone = strokes < par ? "text-primary" : "";
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-30 flex items-end bg-black/40 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
      <motion.div
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        transition={{ type: "spring", bounce: 0, duration: 0.35 }}
        className="flex w-full flex-col gap-4 rounded-3xl bg-card p-5"
        role="dialog"
        aria-label="Hole finished"
      >
        <div className="text-center">
          <h2 className={cn("font-display text-title", tone)}>{scoreName(strokes, par)}</h2>
          <p className="text-callout text-muted-foreground">
            {strokes} {strokes === 1 ? "stroke" : "strokes"} on a par {par}
          </p>
        </div>
        {scores.length > 0 && (
          <ul className="flex flex-col gap-2">
            {scores
              .slice()
              .sort((a, b) => a.best - b.best)
              .slice(0, 4)
              .map((r) => (
                <li key={r.userId} className="flex items-center gap-2 text-callout">
                  <PlayerAvatar name={r.name} image={r.image ?? undefined} size={28} className="rounded-full" />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="font-display">{r.best}</span>
                </li>
              ))}
          </ul>
        )}
        <div className="flex gap-2.5">
          <Button size="xl" variant="secondary" className="flex-1" onClick={onAgain}>
            Again
          </Button>
          <Button size="xl" className="flex-1" onClick={onNext}>
            {next ? "Next hole" : "Done"}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
