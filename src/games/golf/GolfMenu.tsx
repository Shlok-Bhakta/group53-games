import { useNavigate } from "react-router";
import { CopyIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { modePath, settingsOf, type ModeKey } from "../../../convex/modes";
import type { GolfState } from "../../../convex/golf/round";
import { GameMenu } from "@/components/GameMenu";
import { ResignButton } from "@/components/match";
import { Button } from "@/components/ui/button";
import { Scorecard } from "./Scorecard";
import { golfRules } from "./rules";

// A golf game's menu: the scorecard, the seed (to copy, or to play the same holes again), then what every
// game's menu has, and resigning at the bottom.
export function GolfMenu({ open, onOpenChange, match, st, meId, playing }: { open: boolean; onOpenChange: (o: boolean) => void; match: MatchView; st: GolfState; meId: Id<"users"> | undefined; playing: boolean }) {
  return (
    <GameMenu
      open={open}
      onOpenChange={onOpenChange}
      match={match}
      title="Scorecard"
      rules={golfRules(match.mode as ModeKey, settingsOf(match.mode, match.settings))}
      footer={playing && <ResignButton match={match} className="h-14 w-full rounded-lg" detail={match.players.length - st.out.length > 2 ? "Your ball comes off the course and you place last. Everyone else plays on." : "The other player wins and gets the rating points."} />}
    >
      <Scorecard match={match} st={st} meId={meId} />
      <SeedRow match={match} />
    </GameMenu>
  );
}

// A generated course's seed: copy it, or start a new game on the same holes with the same settings.
export function SeedRow({ match }: { match: MatchView }) {
  const navigate = useNavigate();
  const s = settingsOf(match.mode, match.settings);
  if (s.course !== 0 || !s.seed) return null;
  const again = () => {
    const settings = encodeURIComponent(JSON.stringify(match.settings ?? {}));
    navigate(`${modePath(match.mode as ModeKey)}?settings=${settings}`);
  };
  return (
    <div className="mt-3 grid gap-2">
      <Button
        variant="secondary"
        className="h-12 w-full justify-start rounded-lg font-display"
        aria-label={`Copy seed ${s.seed}`}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(String(s.seed))
            .then(() => toast.success("Seed copied"))
            .catch(() => toast(`Seed ${s.seed}`))
        }
      >
        <CopyIcon weight="bold" /> Seed {s.seed}
      </Button>
      <Button variant="secondary" className="h-12 w-full justify-start rounded-lg" onClick={again}>
        <ArrowClockwiseIcon weight="bold" /> Play these holes
      </Button>
    </div>
  );
}
