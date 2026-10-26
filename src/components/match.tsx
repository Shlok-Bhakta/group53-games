import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useMutation } from "convex/react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { ArrowsClockwiseIcon, CrownSimpleIcon, FlagIcon, PlayIcon, ShareNetworkIcon, SpinnerGapIcon, UserPlusIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MatchView } from "../../convex/matches";
import { MODES, acceptPath, flexibleSeats, matchPath, modePath, settingsOf, settingsSummary, type ModeKey } from "../../convex/modes";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
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
import { AsyncButton } from "@/components/AsyncButton";
import { SettingsSection } from "@/components/SettingsPicker";
import { OnlineDot, usePresence } from "@/presence";
import { shareLink } from "@/share";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";
import { listNames, ordinal, reasonText } from "@/lib/text";
import { Tiles, type TileState } from "@/Tiles";
import { SEAT_COLORS } from "@/games/seats";
import { pointsOf } from "@/games/summary";

// The parts of a game screen every game shares: who's here, the lobby, resigning, and the result with its
// rematch.

type Player = MatchView["players"][number];

// Someone with this game open right now.
export function useHere(userId: Id<"users">) {
  const { pathname } = useLocation();
  const { isOnline, byUser } = usePresence();
  return { online: isOnline(userId), here: isOnline(userId) && byUser.get(userId)?.path === pathname };
}

export function ThinkingDots() {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="size-1.5 rounded-full bg-muted-foreground" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
      ))}
    </span>
  );
}

// The result, spelled in tiles: WON in green, LOST with a crooked red hit tile, DRAW in yellow, and places
// for four players.
function resultTiles(match: MatchView, meId: Id<"users"> | undefined): { word: string; states: TileState[] } | null {
  const r = match.result!;
  if (!meId || !match.players.some((p) => p.userId === meId)) return null;
  if (r.standings && match.players.length > 2) {
    const place = r.standings.findIndex((g) => g.includes(meId));
    if (place === 0) return { word: r.standings[0].length > 1 ? "TIE" : "1ST", states: ["green", "green", "green"] };
    const word = ordinal(place + 1).toUpperCase();
    return { word, states: place === 1 ? ["yellow", "yellow", "yellow"] : ["gray", "gray", "hit"] };
  }
  if (r.draw) return { word: "DRAW", states: ["yellow", "yellow", "yellow", "yellow"] };
  return r.winners.includes(meId) ? { word: "WON", states: ["green", "green", "green"] } : { word: "LOST", states: ["gray", "gray", "gray", "hit"] };
}

export function Result({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const r = match.result!;
  const iPlayed = match.players.some((p) => p.userId === meId);
  const four = match.players.length > 2;
  // Games that keep score list everyone's final points, even with two players.
  const scored = match.players.some((p) => pointsOf(match, p.userId) !== null);
  const change = match.ratingChanges?.find((c) => c.userId === meId);
  const nameOf = (id: Id<"users">) => match.players.find((p) => p.userId === id)?.name ?? "?";
  let title: string;
  if (four && r.standings) {
    const place = meId ? r.standings.findIndex((g) => g.includes(meId)) : -1;
    title = place === 0 ? (r.standings[0].length > 1 ? "Shared first" : "You won") : place > 0 ? `You placed ${ordinal(place + 1)}` : `${listNames(r.standings[0].map(nameOf))} won`;
  } else {
    const won = !r.draw && meId && r.winners.includes(meId);
    title = r.draw ? "Draw" : !iPlayed ? `${match.players.find((p) => r.winners.includes(p.userId))?.name} won` : won ? "You won" : "You lost";
  }
  const tiles = resultTiles(match, meId);
  return (
    <section aria-label="Result" className="flex flex-col items-center text-center">
      {tiles ? (
        <>
          <Tiles word={tiles.word} states={tiles.states} size="xl" flip label={title} />
          <h2 className="sr-only">{title}</h2>
        </>
      ) : (
        <h2 className="font-display text-title">{title}</h2>
      )}
      <p className="mt-3 text-callout text-muted-foreground">{reasonText(r.reason, match.mode)}</p>
      {change && <RatingChange before={change.before} after={change.after} />}
      {(four || scored) && r.standings && <Standings match={match} standings={r.standings} meId={meId} />}
      {iPlayed && meId && <Rematch match={match} meId={meId} />}
    </section>
  );
}

// The new rating counts up (or down) from the old one.
function RatingChange({ before, after }: { before: number; after: number }) {
  const value = useMotionValue(before);
  const shown = useTransform(value, (v) => Math.round(v));
  useEffect(() => {
    const controls = animate(value, after, { duration: 1.1, delay: 0.5, ease: [0.23, 1, 0.32, 1] });
    return () => controls.stop();
  }, [value, after]);
  const delta = after - before;
  return (
    <p className="mt-3 flex items-center gap-2.5">
      <motion.span className="font-display text-title tabular-nums">{shown}</motion.span>
      <span className={cn("rounded-full px-2.5 py-1 text-footnote font-bold tabular-nums", delta >= 0 ? "bg-[var(--tile-green)] text-[var(--tile-ink)]" : "bg-destructive/15 text-destructive")}>
        {delta >= 0 ? "+" : ""}
        {delta}
      </span>
      <span className="sr-only">{`${after} (${delta >= 0 ? "+" : ""}${delta})`}</span>
    </p>
  );
}

function Standings({ match, standings, meId }: { match: MatchView; standings: Id<"users">[][]; meId: Id<"users"> | undefined }) {
  return (
    <ol className="mt-4 w-full divide-y divide-border overflow-hidden rounded-lg bg-card text-left" aria-label="Final standings">
      {standings.flatMap((group, place) =>
        group.map((id) => {
          const p = match.players.find((x) => x.userId === id)!;
          const c = match.ratingChanges?.find((x) => x.userId === id);
          const d = c ? c.after - c.before : 0;
          return (
            <li key={id} className={cn("flex min-h-12 items-center gap-3 px-4 py-2", id === meId && "bg-primary/8")}>
              <span className={cn("w-8 font-display text-body tabular-nums", place === 0 ? "text-[var(--tile-yellow)]" : "text-muted-foreground")}>{ordinal(place + 1)}</span>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: SEAT_COLORS[p.color!] }} />
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              {pointsOf(match, id) !== null && <span className="text-footnote tabular-nums text-muted-foreground">{pointsOf(match, id)} pts</span>}
              {c && <span className={cn("w-10 text-right text-footnote font-semibold tabular-nums", d >= 0 ? "text-[var(--tile-green)]" : "text-destructive")}>{d >= 0 ? "+" : ""}{d}</span>}
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

// Waiting for players: who's in, the settings, then the actions at the bottom of the screen.
export function Lobby({ match, meId, onLeave }: { match: MatchView; meId: Id<"users"> | undefined; onLeave: () => void }) {
  const join = useMutation(api.matches.join);
  const cancel = useMutation(api.matches.cancel);
  const decline = useMutation(api.matches.decline);
  const leave = useMutation(api.matches.leave);
  const startGame = useMutation(api.matches.startGame);
  const [params, setParams] = useSearchParams();
  const mode = MODES[match.mode as ModeKey];
  const flexible = flexibleSeats(match.mode);
  const host = match.players.find((p) => p.userId === match.createdBy) ?? match.players[0];
  const isHost = match.createdBy === meId;
  const joined = match.players.some((p) => p.userId === meId);
  const invitedMe = !!meId && match.invited.includes(meId) && !joined;
  const pendingInvites = match.invitedPeople.filter((p) => !p.joined);
  const open = match.invited.length === 0 || match.openSeats === true;
  const freeSeats = mode.players - match.players.length - pendingInvites.length;
  const canJoin = !joined && (invitedMe || (open && freeSeats > 0));
  const needed = mode.players - match.players.length;
  const enough = match.players.length >= mode.minPlayers;

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
      .then(() => toast.success(flexible ? "You're in" : needed > 1 ? `You're in. Waiting for ${needed - 1} more.` : "You're in"))
      .catch((err) => toast.error(errorText(err)));
  }, [autoJoin, meId, match.status, match._id, canJoin, join, needed, setParams, flexible]);

  if (match.status === "cancelled") {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Tiles word="OFF" states={["gray", "gray", "hit"]} size="lg" label="Off" />
          <h2 className="mt-3 font-display text-title">This game was called off</h2>
        </div>
        <Button size="xl" variant="secondary" className="w-full" onClick={onLeave}>
          Back home
        </Button>
      </div>
    );
  }

  const title = flexible
    ? isHost
      ? enough ? `${match.players.length} in` : pendingInvites.length ? "Challenge sent" : "Waiting for players"
      : joined ? `Waiting for ${host.name} to start` : invitedMe ? `${host.name} challenged you` : `${host.name} wants a game`
    : isHost
      ? match.invited.length > 0 && !open && match.players.length === 1 ? "Challenge sent" : mode.players === 2 ? "Looking for an opponent" : `Waiting for ${needed} more`
      : joined
        ? `You're in. Waiting for ${needed} more`
        : invitedMe
          ? `${host.name} challenged you`
          : `${host.name} wants a game`;
  const share = (
    <Button size="xl" variant={flexible ? "secondary" : "default"} onClick={() => void shareLink(acceptPath(match), `${mode.title[0].toUpperCase()}${mode.title.slice(1)}, come play:`)}>
      <ShareNetworkIcon weight="bold" /> Share invite link
    </Button>
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
        {mode.players > 2 ? <Seats match={match} /> : <PlayerAvatar name={host.name} image={host.image} frame={host.frame} frameColor={host.frameColor} badge={host.badge} size={96} />}
        <h2 className="font-display text-title">{title}</h2>
      </div>
      <LobbySettings match={match} editable={isHost} />
      {isHost ? (
        <div className="grid w-full gap-2">
          {flexible && (
            <AsyncButton size="xl" disabled={!enough} icon={<PlayIcon weight="fill" />} onClick={() => startGame({ id: match._id })}>
              {enough ? `Start with ${match.players.length}` : `Needs ${mode.minPlayers} to start`}
            </AsyncButton>
          )}
          {share}
          <AsyncButton size="xl" variant="ghost" className="text-destructive" onClick={() => cancel({ id: match._id }).then(onLeave)}>
            Cancel game
          </AsyncButton>
        </div>
      ) : joined ? (
        <AsyncButton size="xl" variant="ghost" className="w-full" onClick={() => leave({ id: match._id }).then(onLeave)}>
          Leave
        </AsyncButton>
      ) : canJoin ? (
        <div className="grid w-full gap-2">
          <AsyncButton size="xl" onClick={() => join({ id: match._id })}>
            {invitedMe ? "Accept" : "Join game"}
          </AsyncButton>
          {invitedMe && (
            <AsyncButton size="xl" variant="ghost" onClick={() => decline({ id: match._id }).then(onLeave)}>
              Decline
            </AsyncButton>
          )}
        </div>
      ) : (
        <p className="py-3 text-center text-callout text-muted-foreground">{open ? "Every seat is taken." : "This is a private challenge."}</p>
      )}
    </div>
  );
}

// The game's settings in the lobby. The host can still change them, and everyone else watches them change.
function LobbySettings({ match, editable }: { match: MatchView; editable: boolean }) {
  const configure = useMutation(api.matches.configure);
  const mode = match.mode as ModeKey;
  const value = settingsOf(mode, match.settings);
  const summary = settingsSummary(mode, match.settings);
  if ((MODES[mode].settings as readonly unknown[]).length === 0) return null;
  if (!editable) {
    if (summary.length === 0) return null;
    return (
      <ul className="mb-5 flex flex-wrap justify-center gap-2" aria-label="Settings">
        {summary.map((s) => (
          <motion.li key={s} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="rounded-full bg-card px-3 py-1.5 text-footnote font-semibold">
            {s}
          </motion.li>
        ))}
      </ul>
    );
  }
  return (
    <div className="mb-3">
      <SettingsSection
        mode={mode}
        value={value}
        // Only what changed, so two quick taps can't undo each other.
        onChange={(next) => void configure({ id: match._id, settings: Object.fromEntries(Object.entries(next).filter(([k, v]) => value[k] !== v)) }).catch((e) => toast.error(errorText(e)))}
      />
    </div>
  );
}

// The seats of a bigger game: who's in, who's been asked, and what's still open. Games that start whenever
// the host likes show one open seat, not all of them.
function Seats({ match }: { match: MatchView }) {
  const mode = MODES[match.mode as ModeKey];
  const pending = match.invitedPeople.filter((p) => !p.joined);
  const free = Math.max(0, mode.players - match.players.length - pending.length);
  const open = flexibleSeats(match.mode) ? Math.min(1, free) : free;
  return (
    <ul className="grid w-full grid-cols-4 gap-x-2 gap-y-4" aria-label="Seats">
      {match.players.map((p) => (
        <motion.li key={p.userId} layout initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} className="flex min-w-0 flex-col items-center gap-1.5">
          <PlayerAvatar name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={60} />
          <span className="w-full truncate text-footnote font-semibold">{p.name}</span>
        </motion.li>
      ))}
      {pending.map((p) => (
        <li key={p.userId} className="flex min-w-0 flex-col items-center gap-1.5">
          <span className="block opacity-45">
            <PlayerAvatar name={p.name} image={p.image} size={60} />
          </span>
          <span className="w-full truncate text-footnote text-muted-foreground" aria-label={`Asked ${p.name}`}>
            {p.name}
          </span>
        </li>
      ))}
      {Array.from({ length: open }, (_, i) => (
        <li key={`open${i}`} className="flex flex-col items-center gap-1.5">
          <span className="grid size-[60px] place-items-center rounded-full border-2 border-dashed border-muted-foreground/40 text-muted-foreground">
            <UserPlusIcon size={22} weight="bold" />
          </span>
          <span className="text-footnote text-muted-foreground">Open</span>
        </li>
      ))}
    </ul>
  );
}

// Resign, behind a confirmation. `detail` says what happens next in this game.
export function ResignButton({ match, detail, className }: { match: MatchView; detail: string; className?: string }) {
  const resign = useMutation(api.matches.resign);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary" className={cn("text-destructive", className)}>
          <FlagIcon weight="bold" /> Resign
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Resign this game?</AlertDialogTitle>
          <AlertDialogDescription>{detail}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep playing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void resign({ id: match._id }).catch((e) => toast.error(errorText(e)))}>
            Resign
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
