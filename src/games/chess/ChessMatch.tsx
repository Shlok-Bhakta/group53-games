import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { ArrowLeftIcon, ArrowsClockwiseIcon, CrownSimpleIcon, FlagIcon, HandshakeIcon, ShareNetworkIcon, SpinnerGapIcon, UserPlusIcon } from "@phosphor-icons/react";
import { Chess } from "chess.js";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ClassicState, FourState, RealtimeState } from "../../../convex/chess";
import type { State as RtState } from "../../../convex/chess/realtime";
import type { MatchView } from "../../../convex/matches";
import { MODES, modePath, type ModeKey } from "../../../convex/modes";
import { BackHeader } from "@/components/AppHeader";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { OnlineDot, usePresence } from "@/presence";
import { shareLink } from "@/share";
import { cn } from "@/lib/utils";
import { ClassicGame } from "./ClassicGame";
import { FourGame, SEAT_COLORS } from "./FourGame";
import { RealtimeGame } from "./RealtimeGame";
import { AsyncButton } from "@/components/AsyncButton";
import { errorText } from "@/lib/errors";
import { COLOR_NAMES, listNames, ordinal, reasonText } from "./text";

export { errorText } from "@/lib/errors";

type Player = MatchView["players"][number];
const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

export function ChessMatch() {
  const { id } = useParams<{ id: string }>();
  const matchId = id as Id<"matches">;
  const match = useQuery(api.matches.get, { id: matchId });
  const me = useQuery(api.users.me);
  const navigate = useNavigate();
  const location = useLocation();
  const home = match ? modePath(match.mode as ModeKey) : "/chess";
  // Back goes wherever you came from (the home inbox, a mode page); straight from a link, to the mode.
  const goBack = () => (location.key !== "default" ? navigate(-1) : navigate(home, { replace: true }));

  const back = (
    <Button variant="ghost" size="icon" aria-label="Back" onClick={goBack}>
      <ArrowLeftIcon size={24} weight="bold" />
    </Button>
  );

  if (match === undefined) {
    return (
      <div>
        <BackHeader title="Chess" back={back} />
        <Skeleton className="aspect-square w-full rounded-xl" />
      </div>
    );
  }
  if (match === null) {
    return (
      <div>
        <BackHeader title="Chess" back={back} />
        <p className="pt-6 text-muted-foreground">This game doesn't exist.</p>
      </div>
    );
  }

  const mode = MODES[match.mode as ModeKey];
  const four = mode.players > 2;
  const meId = me?._id;
  const mine = match.players.find((p) => p.userId === meId);
  const opponent = match.players.find((p) => p.userId !== meId) ?? null;
  const share = (
    <Button variant="ghost" size="icon" aria-label="Share this game" onClick={() => void shareLink(`/chess/${match._id}`, `${capitalize(mode.title)} on Group 53:`)}>
      <ShareNetworkIcon size={22} weight="bold" />
    </Button>
  );

  const game =
    match.mode === "chess:classic" ? <ClassicGame match={match} meId={meId} /> : match.mode === "chess:four" ? <FourGame match={match} meId={meId} /> : <RealtimeGame match={match} meId={meId} />;

  return (
    <div className="flex flex-col gap-3">
      <BackHeader title={capitalize(mode.title)} back={back} action={share} />

      {match.status === "waiting" || match.status === "cancelled" ? (
        <Lobby match={match} meId={meId} onLeave={() => navigate(home, { replace: true })} />
      ) : four ? (
        <>
          <FourPanel match={match} meId={meId} />
          {game}
          {match.status === "finished" ? <Result match={match} meId={meId} /> : mine ? <Controls match={match} meId={meId!} /> : <p className="text-center text-sm text-muted-foreground">You're watching.</p>}
        </>
      ) : (
        <>
          <PlayerBar player={opponent ?? match.players[0]} match={match} />
          {game}
          <PlayerBar player={mine ?? match.players[1]} match={match} />
          {match.status === "finished" ? <Result match={match} meId={meId} /> : mine ? <Controls match={match} meId={meId!} /> : <p className="text-center text-sm text-muted-foreground">You're watching.</p>}
        </>
      )}
    </div>
  );
}

function sideToMove(match: MatchView) {
  if (match.mode !== "chess:classic") return null;
  return new Chess((match.state as ClassicState).fen).turn();
}

function PlayerBar({ player, match }: { player: Player; match: MatchView }) {
  const { isOnline } = usePresence();
  const toMove = match.status === "active" && sideToMove(match) === player.color;
  const winner = match.result && !match.result.draw && match.result.winners.includes(player.userId);
  const ready = match.mode === "chess:realtime" && (match.state as RealtimeState)?.startAt === null && (match.state as RealtimeState)?.ready.includes(player.userId);
  return (
    <div className="flex min-h-12 items-center gap-3">
      <span className="relative">
        <PlayerAvatar name={player.name} image={player.image} frame={player.frame} frameColor={player.frameColor} size={40} />
        <span className="absolute -bottom-0.5 -right-0.5">
          <OnlineDot online={isOnline(player.userId)} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold leading-tight">
          {player.name} {player.badge}
        </p>
        <p className="text-xs text-muted-foreground">{COLOR_NAMES[player.color ?? ""] ?? ""}</p>
      </div>
      {toMove && (
        <motion.span
          layoutId={`turn-${match._id}`}
          className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground"
          transition={{ type: "spring", stiffness: 500, damping: 34 }}
        >
          To move
        </motion.span>
      )}
      {ready && <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">Ready</span>}
      {winner && <span className="rounded-full bg-[var(--tile-green)] px-3 py-1 text-xs font-bold text-[var(--tile-ink)]">Winner</span>}
    </div>
  );
}

const SEAT_ORDER = ["red", "blue", "yellow", "green"];

// Who's out in a real-time four-player game, from the settled snapshot (it trails live play by under a second).
function useRtOut(match: MatchView) {
  const rt = useQuery(api.chess.rtState, match.mode === "chess:realtime4" ? { id: match._id } : "skip");
  return ((rt?.snapshot as RtState | null)?.out ?? []).map((o) => o.color);
}

// Four seats in turn order: who's to move, points, who's out.
function FourPanel({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const { isOnline } = usePresence();
  const rtOut = useRtOut(match);
  const classic = match.mode === "chess:four" ? (match.state as FourState) : null;
  const rt = match.mode === "chess:realtime4" ? (match.state as RealtimeState) : null;
  const seats = SEAT_ORDER.map((c) => match.players.find((p) => p.color === c)).filter((p) => !!p);
  return (
    <div className="grid grid-cols-2 gap-2" aria-label="Players">
      {seats.map((p) => {
        const out = classic ? classic.out.find((o) => o.color === p.color) : rtOut.includes(p.color!) ? { reason: "king" } : undefined;
        const toMove = match.status === "active" && classic?.turn === p.color;
        const ready = rt && rt.startAt === null && rt.ready.includes(p.userId);
        const winner = match.result?.winners.includes(p.userId);
        return (
          <div
            key={p.userId}
            data-seat={p.color}
            className={cn(
              "relative flex min-h-14 items-center gap-2.5 overflow-hidden rounded-2xl border bg-card py-2 pl-3.5 pr-2.5 transition-opacity",
              p.userId === meId && "ring-2 ring-primary/60",
              out && "opacity-55",
            )}
          >
            <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: SEAT_COLORS[out ? "dead" : p.color!] }} />
            <span className="relative shrink-0">
              <PlayerAvatar name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={34} />
              <span className="absolute -bottom-0.5 -right-0.5">
                <OnlineDot online={isOnline(p.userId)} />
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-tight">{p.userId === meId ? "You" : p.name}</span>
              <span className="block truncate text-xs tabular-nums text-muted-foreground">
                {out ? outText(out.reason) : ready ? "Ready" : classic ? `${classic.points[p.color as keyof FourState["points"]]} pts` : COLOR_NAMES[p.color!]}
              </span>
            </span>
            {toMove && (
              <motion.span layoutId={`turn-${match._id}`} className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground" transition={{ type: "spring", stiffness: 500, damping: 34 }}>
                Move
              </motion.span>
            )}
            {winner && <CrownSimpleIcon size={18} weight="fill" className="shrink-0 text-[var(--tile-yellow)]" aria-label="Winner" />}
          </div>
        );
      })}
    </div>
  );
}

const outText = (reason: string) => ({ checkmate: "Checkmated", stalemate: "Stalemated", resign: "Resigned", timeout: "Timed out", king: "King fell" })[reason] ?? "Out";

function Controls({ match, meId }: { match: MatchView; meId: Id<"users"> }) {
  const offerDraw = useMutation(api.matches.offerDraw);
  const declineDraw = useMutation(api.matches.declineDraw);
  const resign = useMutation(api.matches.resign);
  const rtOut = useRtOut(match);
  const four = match.players.length > 2;
  const myColor = match.players.find((p) => p.userId === meId)?.color;
  const alreadyOut = match.mode === "chess:four" ? (match.state as FourState).out.some((o) => o.color === myColor) : rtOut.includes(myColor ?? "");
  const theyOffered = match.drawOffer && match.drawOffer !== meId;
  const iOffered = match.drawOffer === meId;
  if (four && alreadyOut) return <p className="text-center text-sm text-muted-foreground">You're out. Stick around to see who wins.</p>;
  const resignButton = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="lg" className={four ? "w-full" : undefined}>
          <FlagIcon weight="bold" /> Resign
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Resign this game?</AlertDialogTitle>
          <AlertDialogDescription>
            {four ? "Your army turns grey and the others play on. You keep your place for how long you lasted." : "Your opponent gets the win and the rating points."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-12">Keep playing</AlertDialogCancel>
          <AlertDialogAction className="h-12" variant="destructive" onClick={() => void resign({ id: match._id }).catch((e) => toast.error(errorText(e)))}>
            Resign
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  if (four) return <div className="pt-1">{resignButton}</div>;
  return (
    <div className="flex flex-col gap-2.5 pt-1">
      {theyOffered && (
        <div className="flex items-center gap-2 rounded-2xl border bg-card p-3">
          <HandshakeIcon size={22} weight="fill" className="text-primary" />
          <span className="flex-1 font-medium">Draw offered</span>
          <AsyncButton size="sm" variant="secondary" onClick={() => declineDraw({ id: match._id })}>
            No
          </AsyncButton>
          <AsyncButton size="sm" onClick={() => offerDraw({ id: match._id })}>
            Accept
          </AsyncButton>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <AsyncButton variant="secondary" size="lg" disabled={iOffered} icon={<HandshakeIcon weight="bold" />} onClick={() => offerDraw({ id: match._id })}>
          {iOffered ? "Draw offered" : "Offer draw"}
        </AsyncButton>
        {resignButton}
      </div>
    </div>
  );
}

function Result({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const r = match.result!;
  const iPlayed = match.players.some((p) => p.userId === meId);
  const four = match.players.length > 2;
  const change = match.ratingChanges?.find((c) => c.userId === meId);
  const delta = change ? change.after - change.before : null;
  const nameOf = (id: Id<"users">) => match.players.find((p) => p.userId === id)?.name ?? "?";
  let title: string;
  if (four && r.standings) {
    const place = meId ? r.standings.findIndex((g) => g.includes(meId)) : -1;
    title = place === 0 ? (r.standings[0].length > 1 ? "Shared first" : "You won") : place > 0 ? `You placed ${ordinal(place + 1)}` : `${listNames(r.standings[0].map(nameOf))} won`;
  } else {
    const won = !r.draw && meId && r.winners.includes(meId);
    title = r.draw ? "Draw" : !iPlayed ? `${match.players.find((p) => r.winners.includes(p.userId))?.name} won` : won ? "You won" : "You lost";
  }
  return (
    <motion.section
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className="rounded-3xl border bg-card p-5 text-center"
    >
      <h2 className="font-display text-3xl">{title}</h2>
      <p className="mt-1 text-muted-foreground">{reasonText(r.reason, match.mode)}</p>
      {delta !== null && change && (
        <p className="mt-3 text-lg font-semibold tabular-nums">
          {change.after} <span className={delta >= 0 ? "text-[var(--tile-green)]" : "text-destructive"}>({delta >= 0 ? "+" : ""}{delta})</span>
        </p>
      )}
      {four && r.standings && <Standings match={match} standings={r.standings} meId={meId} />}
      {iPlayed && meId && <Rematch match={match} meId={meId} />}
    </motion.section>
  );
}

function Standings({ match, standings, meId }: { match: MatchView; standings: Id<"users">[][]; meId: Id<"users"> | undefined }) {
  const points = match.mode === "chess:four" ? (match.state as FourState).points : null;
  return (
    <ol className="mt-4 divide-y overflow-hidden rounded-2xl border text-left" aria-label="Final standings">
      {standings.flatMap((group, place) =>
        group.map((id) => {
          const p = match.players.find((x) => x.userId === id)!;
          const c = match.ratingChanges?.find((x) => x.userId === id);
          const d = c ? c.after - c.before : 0;
          return (
            <li key={id} className={cn("flex min-h-12 items-center gap-3 px-3 py-2", id === meId && "bg-primary/8")}>
              <span className={cn("w-8 font-display text-lg tabular-nums", place === 0 ? "text-[var(--tile-yellow)]" : "text-muted-foreground")}>{ordinal(place + 1)}</span>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: SEAT_COLORS[p.color!] }} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              {points && <span className="text-sm tabular-nums text-muted-foreground">{points[p.color as keyof typeof points]} pts</span>}
              {c && <span className={cn("w-10 text-right text-sm font-semibold tabular-nums", d >= 0 ? "text-[var(--tile-green)]" : "text-destructive")}>{d >= 0 ? "+" : ""}{d}</span>}
            </li>
          );
        }),
      )}
    </ol>
  );
}

const REMATCH_TTL_MS = 2 * 60 * 1000;

// Rematches happen right here: asking turns everyone else's button into Accept, the new game starts once
// everyone's in and moves all the phones to it, and leaving the page declines.
function Rematch({ match, meId }: { match: MatchView; meId: Id<"users"> }) {
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

  // Accepted: every phone moves to the new game.
  useEffect(() => {
    if (offer?.status === "accepted" && offer.matchId) navigate(`/chess/${offer.matchId}`, { replace: true });
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

  if (offer?.status === "accepted") {
    return (
      <p className="mt-4 flex items-center justify-center gap-2 text-muted-foreground">
        <SpinnerGapIcon className="animate-spin" weight="bold" /> Starting the rematch…
      </p>
    );
  }
  if (pending && !iSaidYes) {
    const alsoIn = yes.filter((id) => id !== offer!.by).length;
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex flex-col gap-2.5">
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
      </motion.div>
    );
  }
  if (pending && iSaidYes) {
    return (
      <div className="mt-4 flex flex-col gap-2.5">
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
      <div className="mt-4 flex flex-col gap-2.5">
        <p className="text-muted-foreground">{declinedByThem ? (others.length > 1 ? "Someone passed on a rematch." : `${others[0]?.name} passed on a rematch.`) : "Rematch declined."}</p>
        <Button size="xl" className="w-full" onClick={() => navigate(modePath(match.mode as ModeKey))}>
          New game
        </Button>
      </div>
    );
  }
  return (
    <AsyncButton size="xl" className="mt-4 w-full" icon={<ArrowsClockwiseIcon weight="bold" />} onClick={() => rematch({ id: match._id })}>
      Rematch
    </AsyncButton>
  );
}

function Lobby({ match, meId, onLeave }: { match: MatchView; meId: Id<"users"> | undefined; onLeave: () => void }) {
  const join = useMutation(api.matches.join);
  const cancel = useMutation(api.matches.cancel);
  const decline = useMutation(api.matches.decline);
  const leave = useMutation(api.matches.leave);
  const [params, setParams] = useSearchParams();
  const mode = MODES[match.mode as ModeKey];
  const host = match.players.find((p) => p.userId === match.createdBy) ?? match.players[0];
  const isHost = match.createdBy === meId;
  const joined = match.players.some((p) => p.userId === meId);
  const invitedMe = !!meId && match.invited.includes(meId) && !joined;
  const pendingInvites = match.invitedPeople.filter((p) => !p.joined);
  const open = match.invited.length === 0 || match.openSeats === true;
  const freeSeats = mode.players - match.players.length - pendingInvites.length;
  const canJoin = !joined && (invitedMe || (open && freeSeats > 0));
  const needed = mode.players - match.players.length;

  // Opening a challenge or lobby from a push (or an invite link) takes the seat straight away.
  const autoJoin = params.get("accept") === "1";
  const tried = useRef(false);
  useEffect(() => {
    if (!autoJoin || tried.current || !meId || match.status !== "waiting") return;
    tried.current = true;
    setParams((p) => {
      p.delete("accept");
      return p;
    }, { replace: true });
    if (!canJoin) return;
    join({ id: match._id })
      .then(() => toast.success(needed > 1 ? `You're in. Waiting for ${needed - 1} more.` : "You're in"))
      .catch((err) => toast.error(errorText(err)));
  }, [autoJoin, meId, match.status, match._id, canJoin, join, needed, setParams]);

  if (match.status === "cancelled") {
    return (
      <div className="rounded-3xl border bg-card p-6 text-center">
        <h2 className="font-display text-2xl">This game was called off</h2>
        <Button size="xl" variant="secondary" className="mt-4 w-full" onClick={onLeave}>
          Back to {mode.name}
        </Button>
      </div>
    );
  }

  const title = isHost
    ? match.invited.length > 0 && !open && match.players.length === 1 ? "Challenge sent" : mode.players === 2 ? "Looking for an opponent" : `Waiting for ${needed} more`
    : joined
      ? `You're in. Waiting for ${needed} more`
      : invitedMe
        ? `${host.name} challenged you`
        : `${host.name} wants a game`;

  return (
    <div className="flex flex-col items-center gap-5 rounded-3xl border bg-card p-6 text-center">
      {mode.players > 2 ? (
        <Seats match={match} />
      ) : (
        <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}>
          <PlayerAvatar name={host.name} image={host.image} frame={host.frame} frameColor={host.frameColor} badge={host.badge} size={88} />
        </motion.div>
      )}
      <div>
        <h2 className="font-display text-2xl leading-tight">{title}</h2>
        <p className="mt-1.5 text-muted-foreground">{mode.blurb}</p>
      </div>
      {isHost ? (
        <div className="grid w-full gap-2.5">
          <Button size="xl" variant="secondary" onClick={() => void shareLink(`/chess/${match._id}?accept=1`, `${capitalize(mode.title)}, come play:`)}>
            <ShareNetworkIcon weight="bold" /> Share invite link
          </Button>
          <AsyncButton size="lg" variant="ghost" onClick={() => cancel({ id: match._id }).then(onLeave)}>
            Cancel game
          </AsyncButton>
        </div>
      ) : joined ? (
        <AsyncButton size="lg" variant="ghost" className="w-full" onClick={() => leave({ id: match._id }).then(onLeave)}>
          Leave
        </AsyncButton>
      ) : canJoin ? (
        <div className="grid w-full gap-2.5">
          <AsyncButton size="xl" onClick={() => join({ id: match._id })}>
            {invitedMe ? "Accept" : "Join game"}
          </AsyncButton>
          {invitedMe && (
            <AsyncButton size="lg" variant="ghost" onClick={() => decline({ id: match._id }).then(onLeave)}>
              Decline
            </AsyncButton>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">{open ? "Every seat is taken." : "This is a private challenge."}</p>
      )}
    </div>
  );
}

// The seats of a bigger game: who's in, who's been asked, and what's still open.
function Seats({ match }: { match: MatchView }) {
  const mode = MODES[match.mode as ModeKey];
  const pending = match.invitedPeople.filter((p) => !p.joined);
  const open = Math.max(0, mode.players - match.players.length - pending.length);
  return (
    <ul className="grid w-full grid-cols-4 gap-2" aria-label="Seats">
      {match.players.map((p) => (
        <motion.li key={p.userId} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex min-w-0 flex-col items-center gap-1.5">
          <PlayerAvatar name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={56} />
          <span className="w-full truncate text-xs font-semibold">{p.name}</span>
        </motion.li>
      ))}
      {pending.map((p) => (
        <li key={p.userId} className="flex min-w-0 flex-col items-center gap-1.5">
          <motion.span className="block opacity-50" animate={{ opacity: [0.6, 0.3, 0.6] }} transition={{ duration: 1.8, repeat: Infinity }}>
            <PlayerAvatar name={p.name} image={p.image} size={56} />
          </motion.span>
          <span className="w-full truncate text-xs text-muted-foreground" aria-label={`Asked ${p.name}`}>
            {p.name}
          </span>
        </li>
      ))}
      {Array.from({ length: open }, (_, i) => (
        <li key={`open${i}`} className="flex flex-col items-center gap-1.5">
          <span className="grid size-14 place-items-center rounded-full border-2 border-dashed border-muted-foreground/40 text-muted-foreground">
            <UserPlusIcon size={22} weight="bold" />
          </span>
          <span className="text-xs text-muted-foreground">Open</span>
        </li>
      ))}
    </ul>
  );
}
