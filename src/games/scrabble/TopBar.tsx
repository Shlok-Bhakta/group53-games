import type { Ref } from "react";
import { motion } from "motion/react";
import { CaretLeftIcon, ListIcon } from "@phosphor-icons/react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import type { ScrabbleState } from "../../../convex/scrabble/engine";
import { useGoBack } from "@/components/AppHeader";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Countdown } from "@/components/game/Countdown";
import { FloatButton, FloatPill, FloatingTopBar } from "@/components/game/floating";
import { useTurnText } from "@/components/game/TurnText";
import { ThinkingDots } from "@/presence";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";

// Floats over the top of the board, Letter League style: back, whose turn it is with the last play and the
// clock, and the menu.
export function TopBar({ ref, match, state, meId, myTurn, onMenu }: { ref: Ref<HTMLDivElement>; match: MatchView; state: ScrabbleState; meId: Id<"users"> | undefined; myTurn: boolean; onMenu: () => void }) {
  const goBack = useGoBack("/");
  const up = match.players[state.turn];
  const { text, thinking } = useTurnText(up, meId, "Your turn");
  const last = state.moves.at(-1);
  const lastBy = last ? match.players[last.seat] : undefined;
  const lastText =
    !last || !lastBy ? null
    : last.kind === "play" ? `${lastBy.userId === meId ? "You" : lastBy.name}: ${last.words!.map((w) => w.word).join(", ")} +${last.score}`
    : `${lastBy.userId === meId ? "You" : lastBy.name} ${last.kind === "swap" ? `swapped ${last.count}` : last.kind === "pass" ? "passed" : last.kind === "timeout" ? "ran out of time" : "resigned"}`;
  return (
    <FloatingTopBar ref={ref}>
      <FloatButton aria-label="Back" onClick={goBack}>
        <CaretLeftIcon size={22} weight="bold" />
      </FloatButton>
      <FloatPill
        onClick={onMenu}
        aria-label="Players and scores"
        // The whole pill is edged in the color of whoever's turn it is.
        className="flex-1 border-2 py-1 pl-1 pr-3 transition-colors duration-300"
        style={{ borderColor: up ? seatColor(up) : "transparent" }}
      >
        {up && <PlayerAvatar player={up} size={34} className="shrink-0" />}
        <span className="min-w-0 flex-1">
          <motion.span
            key={myTurn ? "mine" : (up?.userId ?? "")}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn("flex items-center gap-1.5 truncate font-display text-callout leading-tight", myTurn && "text-primary")}
            aria-live="polite"
          >
            {text}
            {thinking && <ThinkingDots />}
          </motion.span>
          {lastText && <span className="block truncate text-caption text-muted-foreground">{lastText}</span>}
        </span>
        {state.deadline !== null && <Countdown deadline={state.deadline} mine={myTurn} />}
      </FloatPill>
      <FloatButton aria-label="Menu" onClick={onMenu}>
        <ListIcon size={22} weight="bold" />
      </FloatButton>
    </FloatingTopBar>
  );
}
