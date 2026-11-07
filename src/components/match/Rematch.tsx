import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { ArrowsClockwiseIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { matchPath, modePath, type ModeKey } from "../../../convex/modes";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/AsyncButton";
import { usePresence } from "@/presence";
import { listNames } from "@/lib/text";

const REMATCH_TTL_MS = 2 * 60 * 1000;

// Rematches happen right here: asking turns everyone else's button into Accept, the new game starts once
// everyone's in and moves all the phones to it, and leaving the page declines.
export function Rematch({ match, meId }: { match: MatchView; meId: Id<"users"> }) {
  const rematch = useMutation(api.matches.rematch);
  const answer = useMutation(api.matches.answerRematch);
  const navigate = useNavigate();
  const offer = match.rematch;
  const pending = offer?.status === "pending" && Date.now() - offer.at < REMATCH_TTL_MS;
  const yes = pending ? (offer!.yes ?? [offer!.by]) : [];
  const iSaidYes = yes.includes(meId);
  const others = match.players.filter((p) => p.userId !== meId);
  const waitingOn = others.filter((p) => !yes.includes(p.userId));
  const asker = match.players.find((p) => p.userId === offer?.by);
  const { isOnline } = usePresence();
  const stillHere = others.filter((p) => isOnline(p.userId));

  // Accepted: every phone moves to the new game.
  useEffect(() => {
    if (offer?.status === "accepted" && offer.matchId) navigate(matchPath({ _id: offer.matchId, mode: match.mode }), { replace: true });
  }, [offer?.status, offer?.matchId, navigate]);

  // Leaving the page (or the app) while an offer is open declines it.
  const open = useRef(false);
  open.current = !!pending;
  useEffect(() => {
    const leave = () => open.current && void answer({ id: match._id }).catch(() => {});
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [answer, match._id]);

  const wrap = "mt-6 flex w-full flex-col gap-2.5";
  if (offer?.status === "accepted") {
    return (
      <p className="mt-6 flex items-center justify-center gap-2 text-callout text-muted-foreground">
        <SpinnerGapIcon className="animate-spin" weight="bold" /> Starting the rematch…
      </p>
    );
  }
  if (pending && !iSaidYes) {
    const alsoIn = yes.filter((id) => id !== offer!.by).length;
    return (
      <div className={wrap}>
        <p className="font-semibold">
          {asker?.name} wants a rematch{alsoIn > 0 ? ` (${yes.length}/${match.players.length} in)` : ""}
        </p>
        <div className="grid grid-cols-[auto_1fr] gap-2.5">
          <AsyncButton size="xl" variant="secondary" onClick={() => answer({ id: match._id })}>
            No thanks
          </AsyncButton>
          <AsyncButton size="xl" icon={<ArrowsClockwiseIcon weight="bold" />} onClick={() => rematch({ id: match._id })}>
            Accept rematch
          </AsyncButton>
        </div>
      </div>
    );
  }
  if (pending && iSaidYes) {
    return (
      <div className={wrap}>
        <Button size="xl" variant="secondary" disabled className="w-full">
          <SpinnerGapIcon className="animate-spin" weight="bold" /> Waiting for {listNames(waitingOn.map((p) => p.name))}…
        </Button>
        <AsyncButton size="lg" variant="ghost" onClick={() => answer({ id: match._id })}>
          Cancel
        </AsyncButton>
      </div>
    );
  }
  if (offer?.status === "declined") {
    const declinedByThem = offer.by === meId;
    return (
      <div className={wrap}>
        <p className="text-callout text-muted-foreground">{declinedByThem ? (others.length > 1 ? "Someone passed on a rematch." : `${others[0]?.name} passed on a rematch.`) : "Rematch declined."}</p>
        <Button size="xl" className="w-full" onClick={() => navigate(modePath(match.mode as ModeKey))}>
          New game
        </Button>
      </div>
    );
  }
  return (
    <div className={wrap}>
      {stillHere.length > 0 && (
        <p className="flex items-center justify-center gap-2 text-footnote text-muted-foreground">
          <span className="size-2 rounded-full bg-online" />
          {stillHere.length === others.length ? (others.length === 1 ? `${others[0].name} is still here` : "Everyone's still here") : `${listNames(stillHere.map((p) => p.name))} still here`}
        </p>
      )}
      <AsyncButton size="xl" className="w-full" icon={<ArrowsClockwiseIcon weight="bold" />} onClick={() => rematch({ id: match._id })}>
        Rematch
      </AsyncButton>
    </div>
  );
}
