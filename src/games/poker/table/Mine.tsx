import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { MatchView } from "../../../../convex/matches";
import { VARIANTS, isOut } from "../../../../convex/poker/engine";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { SeatDot } from "@/components/game/SeatDot";
import { useTurnText } from "@/components/game/TurnText";
import { Button } from "@/components/ui/button";
import { PlayingCard } from "@/components/ui/playing-card";
import { OnlineDot, ThinkingDots, useHere } from "@/presence";
import { seatColor } from "@/games/seats";
import type { Player } from "@/games/types";
import { cn } from "@/lib/utils";
import { chips } from "../format";
import { PACE, cardsHeld, type Show } from "../show";
import { usePhoneLandscape } from "@/components/game/landscape";
import { Flying, Roll, SPRING } from "./motion";
import { Bet, Dealer, Float, NameLine, statusOf } from "./Seat";

export function TurnStatus({ match, show }: { match: MatchView; show: Show }) {
  const up = match.status === "active" && show.turn >= 0 ? match.players[show.turn] : undefined;
  const { text, thinking } = useTurnText(up, undefined);
  if (!up) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-footnote font-semibold text-muted-foreground">
      <SeatDot color={seatColor(up)} />
      <span className="truncate">{text}</span>
      {thinking && <ThinkingDots />}
    </span>
  );
}

export function MyTile({
  match,
  player,
  seat,
  show,
  picking,
}: {
  match: MatchView;
  player: Player;
  seat: number;
  show: Show;
  picking: boolean;
}) {
  const s = show.state;
  const { online } = useHere(player.userId);
  const { out, folded, allIn, label } = statusOf(show, seat);
  const color = seatColor(player);
  const up = match.status === "active" && show.turn === seat && !show.busy;
  const won = show.paying?.find((p) => p.seat === seat);
  return (
    <div
      data-seat={player.color}
      data-up={up}
      data-out={out || folded}
      role="group"
      aria-label={`You, ${chips(show.stacks[seat])} chips${label ? `, ${label}` : ""}`}
      className="relative mt-2.5 phone-landscape:mt-0"
      style={{ "--seat": color } as CSSProperties}
    >
      <div className="poker-tile flex h-14 items-center gap-2.5 rounded-lg bg-card px-2.5 phone-landscape:h-auto phone-landscape:flex-wrap phone-landscape:gap-y-2 phone-landscape:py-2">
        <span className="relative shrink-0" data-spot={seat}>
          <span
            className={cn(
              "block rounded-full transition-[box-shadow,opacity,filter] duration-300",
              up && "poker-up",
              (folded || out) && "opacity-55 grayscale",
            )}
          >
            <PlayerAvatar player={player} glow={player.glow} size={38} />
          </span>
          <span className="absolute -right-0.5 -top-0.5 z-[3] [--dot-ring:var(--card)]">
            <OnlineDot online={online} />
          </span>
          {s.button === seat && <Dealer key={`dealer${s.hand}`} className="-left-[5px] -top-0.5" />}
          {won && won.net > 0 && <Float net={won.net} color={color} hand={s.hand} />}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <NameLine player={player} name={player.name} />
          <span className="font-display text-callout">
            <Roll value={show.stacks[seat]} />
          </span>
        </span>
        {show.bets[seat] > 0 && (
          <Bet
            amount={show.bets[seat]}
            color={color}
            sweeping={show.sweeping}
            order={seat}
            label={`You have ${chips(show.bets[seat])} in`}
            className="z-10"
          />
        )}
        <span className="ml-auto flex min-w-0 items-center phone-landscape:ml-0 phone-landscape:basis-full phone-landscape:empty:hidden">
          {up ? (
            <motion.span
              key="turn"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 * PACE, ease: SPRING }}
              className="block whitespace-nowrap rounded-full bg-primary px-3.5 py-[7px] font-display text-callout text-primary-foreground"
            >
              {picking ? "Pick cards to swap" : "Your move"}
            </motion.span>
          ) : out || folded || allIn ? (
            <span className="text-footnote font-semibold text-muted-foreground">{label}</span>
          ) : (
            <TurnStatus match={match} show={show} />
          )}
        </span>
      </div>
    </div>
  );
}

const ROOMY_HEIGHT = 780;

function handLayout(count: number, landscape: boolean) {
  if (landscape) {
    const perRow = count <= 2 ? count : count === 4 ? 2 : 3;
    return { width: count <= 2 ? 66 : count === 4 ? 56 : 50, tilt: count <= 2 ? 8 : 0, perRow };
  }
  const roomy = window.innerHeight >= ROOMY_HEIGHT;
  const width = count <= 2 ? (roomy ? 88 : 66) : count === 4 ? (roomy ? 74 : 62) : roomy ? 66 : 58;
  return { width, tilt: count <= 2 ? 8 : 3, perRow: count };
}

export function MyHand({
  show,
  seat,
  color,
  cards,
  picking,
  swap,
  onPick,
  rung,
  madeName,
}: {
  show: Show;
  seat: number;
  color: string;
  cards: string[] | null;
  picking: boolean;
  swap: number[];
  onPick: (i: number) => void;
  rung: string[];
  madeName: string | null;
}) {
  const s = show.state;
  const count = VARIANTS[s.variant].hole;
  const landscape = usePhoneLandscape();
  const { width, tilt, perRow } = handLayout(count, landscape);
  const sitting = !s.dealt[seat] || isOut(s, seat);
  const held = cardsHeld(s, seat, show.dealtCards);
  const dim = s.dealt[seat] && show.folded[seat];
  return (
    <div role="group" aria-label="Your cards" className="mt-4 flex flex-col items-center gap-1">
      <div
        className={cn("flex items-end justify-center transition-opacity duration-300", landscape && "flex-wrap", dim && "opacity-40")}
        style={
          landscape
            ? { minHeight: Math.ceil(count / perRow) * (width * 1.4 + 2), maxWidth: perRow * (width + 2) }
            : { minHeight: width * 1.4 + 2 }
        }
      >
        {!sitting &&
          Array.from({ length: count }, (_, i) => {
            const angle = (i - (count - 1) / 2) * tilt;
            const c = i < show.faceUp ? (cards?.[i] ?? null) : null;
            const lifted = picking && swap.includes(i);
            const style = { rotate: `${angle}deg`, transformOrigin: "50% 100%" };
            if (i >= held) return <span key={`${s.hand}:${i}`} className="-mx-[3px]" style={{ width, height: width * 1.4 }} />;
            const face = (
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={c ?? "back"}
                  className="block"
                  initial={{ rotateY: -90 }}
                  animate={{ rotateY: 0, y: lifted ? -10 : 0 }}
                  exit={{ rotateY: 90, transition: { duration: 0.12 * PACE, ease: "easeIn" } }}
                  transition={{ type: "spring", bounce: 0.2, duration: 0.3 * PACE }}
                >
                  {c ? (
                    <PlayingCard card={c} width={width} best={picking ? lifted : rung.includes(c)} />
                  ) : (
                    <PlayingCard width={width} seat={color} />
                  )}
                </motion.span>
              </AnimatePresence>
            );
            return (
              <Flying key={`${s.hand}:${i}`} width={width} fly={show.dealtCards !== Infinity} className="-mx-[3px]">
                <span className="block" style={style}>
                  {picking && c ? (
                    <Button variant="bare" size="piece" aria-pressed={lifted} aria-label={`Swap card ${i + 1}`} onClick={() => onPick(i)}>
                      {face}
                    </Button>
                  ) : (
                    face
                  )}
                </span>
              </Flying>
            );
          })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={madeName ?? "none"}
          className="h-[22px] text-callout font-semibold text-muted-foreground"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 * PACE }}
        >
          {madeName ?? ""}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
