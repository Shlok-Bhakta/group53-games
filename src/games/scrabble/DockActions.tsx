import { useMutation } from "convex/react";
import { ArrowCounterClockwiseIcon, ArrowsClockwiseIcon, HandIcon, ShuffleIcon, SkipForwardIcon, ToteSimpleIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { MatchView } from "../../../convex/matches";
import type { evaluate, Placement } from "../../../convex/scrabble/engine";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";

// A square tool in the dock with its name under the icon.
const tool = "flex-col gap-0.5 text-caption [&_svg:not([class*='size-'])]:size-[22px]";

// The bag, with how many tiles are left in it. Tap it for the letters you haven't seen.
export function BagButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <Button variant="secondary" size="dock-square" className={tool} onClick={onClick} aria-label={`Bag, ${count} left`}>
      <ToteSimpleIcon weight="fill" />
      <span className="font-display tabular-nums">{count}</span>
    </Button>
  );
}

// The buttons under your rack: the bag on the left, Swap, Play, and Shuffle (or Recall) on the right.
// Swapping with nothing picked passes the turn instead.
export function DockActions({
  match,
  myTurn,
  placed,
  evaluation,
  bad,
  checking,
  swapping,
  setSwapping,
  bagCount,
  onBag,
  onShuffle,
  onRecall,
  onPlay,
}: {
  match: MatchView;
  myTurn: boolean;
  placed: Placement[];
  evaluation: ReturnType<typeof evaluate> | null;
  bad: string[];
  checking: boolean;
  swapping: number[] | null;
  setSwapping: (s: number[] | null) => void;
  bagCount: number;
  onBag: () => void;
  onShuffle: () => void;
  onRecall: () => void;
  onPlay: () => Promise<void>;
}) {
  const swap = useMutation(api.scrabble.swap);
  const pass = useMutation(api.scrabble.pass);

  if (swapping) {
    const passing = swapping.length === 0;
    return (
      <div className="flex gap-2">
        <Button size="xl" variant="secondary" onClick={() => setSwapping(null)}>
          Cancel
        </Button>
        <AsyncButton
          size="xl"
          className="flex-1"
          variant={passing ? "secondary" : "default"}
          disabled={swapping.length > bagCount}
          icon={passing ? <SkipForwardIcon weight="bold" /> : <ArrowsClockwiseIcon weight="bold" />}
          onClick={async () => {
            if (passing) await pass({ id: match._id });
            else await swap({ id: match._id, tileIds: swapping });
            setSwapping(null);
          }}
        >
          {passing ? "Pass turn" : swapping.length > bagCount ? `Only ${bagCount} in the bag` : `Swap ${swapping.length}`}
        </AsyncButton>
      </div>
    );
  }

  const label =
    !evaluation ? (myTurn ? "Play" : "Your turn's next")
    : !evaluation.ok ? evaluation.error
    : bad.length ? (bad.length === 1 ? `${bad[0]} isn't a word` : `${bad.length} aren't words`)
    : checking ? `${evaluation.score} points`
    : myTurn ? `Play ${evaluation.words[0].word} for ${evaluation.score}`
    : `Planned: ${evaluation.words[0].word}, ${evaluation.score}`;
  const canPlay = myTurn && !!evaluation?.ok && bad.length === 0 && !checking;

  return (
    <div className="flex items-stretch gap-2">
      <BagButton count={bagCount} onClick={onBag} />
      <Button variant="secondary" size="dock-square" className={tool} disabled={!myTurn} onClick={() => setSwapping([])} aria-label="Swap or pass">
        <ArrowsClockwiseIcon weight="bold" />
        Swap
      </Button>
      <AsyncButton size="xl" className="min-w-0 flex-1 px-3" disabled={!canPlay} icon={myTurn ? <HandIcon weight="fill" /> : undefined} onClick={onPlay}>
        <span className="truncate">{label}</span>
      </AsyncButton>
      {placed.length > 0 ? (
        <Button variant="secondary" size="dock-square" className={tool} onClick={onRecall} aria-label="Recall tiles">
          <ArrowCounterClockwiseIcon weight="bold" />
          Recall
        </Button>
      ) : (
        <Button variant="secondary" size="dock-square" className={tool} onClick={onShuffle} aria-label="Shuffle tiles">
          <ShuffleIcon weight="bold" />
          Shuffle
        </Button>
      )}
    </div>
  );
}
