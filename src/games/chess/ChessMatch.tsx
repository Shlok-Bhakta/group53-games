import { useEffect, useRef, type CSSProperties } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { ArrowsClockwiseIcon, CrownSimpleIcon, FlagIcon, HandshakeIcon, ShareNetworkIcon, SpinnerGapIcon, UserPlusIcon } from "@phosphor-icons/react";
import { Chess } from "chess.js";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ClassicState, FourState, RealtimeState } from "../../../convex/chess";
import type { State as RtState } from "../../../convex/chess/realtime";
import type { MatchView } from "../../../convex/matches";
import { MODES, modePath, type ModeKey } from "../../../convex/modes";
import { NavBar } from "@/components/AppHeader";
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
import { Tiles, type TileState } from "@/Tiles";
import { ClassicGame } from "./ClassicGame";
import { FourGame, SEAT_COLORS } from "./FourGame";
import { RealtimeGame } from "./RealtimeGame";
import { Chip } from "./parts";
import { AsyncButton } from "@/components/AsyncButton";
import { errorText } from "@/lib/errors";
import { COLOR_NAMES, listNames, ordinal, reasonText } from "./text";

export { errorText } from "@/lib/errors";

type Player = MatchView["players"][number];

// One game, laid out like a native game screen: a compact bar on top, the board and its players as one
// block in the middle, and the actions docked at the bottom where thumbs are.
export function ChessMatch() {
  const { id } = useParams<{ id: string }>();
  const matchId = id as Id<"matches">;
  const match = useQuery(api.matches.get, { id: matchId });
  const me = useQuery(api.users.me);
  const navigate = useNavigate();

  if (match === undefined) {
    return (
      <div>
        <NavBar title="Chess" />
        <Skeleton className="mt-16 aspect-square w-full rounded-sm" />
      </div>
    );
  }
  if (match === null) {
    return (
      <div>
        <NavBar title="Chess" />
        <p className="pt-4 text-callout text-muted-foreground">This game doesn't exist.</p>
      </div>
    );
  }

  const mode = MODES[match.mode as ModeKey];
  const four = mode.players > 2;
  const meId = me?._id;
  const mine = match.players.find((p) => p.userId === meId);
  const opponent = match.players.find((p) => p.userId !== meId) ?? null;
  const share = (
    <Button variant="ghost" size="icon" aria-label="Share this game" onClick={() => void shareLink(`/chess/${match._id}`, `${mode.name} chess on Group 53:`)}>
      <ShareNetworkIcon size={22} weight="bold" />
    </Button>
  );

  const seats = four ? <FourSeats match={match} meId={meId} /> : null;
  const top = !four ? <PlayerBar player={opponent ?? match.players[0]} match={match} meId={meId} /> : null;
  const bottom = !four ? <PlayerBar player={mine ?? match.players[1]} match={match} meId={meId} /> : <FourStatus match={match} meId={meId} />;
  const game =
    match.mode === "chess:classic" ? (
      <ClassicGame match={match} meId={meId} above={top} below={bottom} />
    ) : match.mode === "chess:four" ? (
      <FourGame match={match} meId={meId} overlay={seats} below={bottom} />
    ) : (
      <RealtimeGame match={match} meId={meId} above={top} below={bottom} overlay={seats} />
    );

  return (
    <div className="flex min-h-[calc(100svh-env(safe-area-inset-bottom)-16px)] flex-col">
      <NavBar title={mode.name} back={modePath(match.mode as ModeKey)} action={share} />
      {match.status === "waiting" || match.status === "cancelled" ? (
        <Lobby match={match} meId={meId} onLeave={() => navigate("/", { replace: true })} />
      ) : (
        <>
          <div className="flex flex-1 flex-col justify-center gap-2 py-2">{game}</div>
          <div className="pt-4">
            {match.status === "finished" ? (
              <Result match={match} meId={meId} />
            ) : mine ? (
              <Controls match={match} meId={meId!} />
            ) : (
              <p className="py-3 text-center text-callout text-muted-foreground">You're watching.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function sideToMove(match: MatchView) {
  if (match.mode !== "chess:classic") return null;
  return new Chess((match.state as ClassicState).fen).turn();
}

// Someone with this game open right now.
function useHere(userId: Id<"users">) {
  const { pathname } = useLocation();
  const { isOnline, byUser } = usePresence();
  return { online: isOnline(userId), here: isOnline(userId) && byUser.get(userId)?.path === pathname };
}

function PlayerBar({ player, match, meId }: { player: Player; match: MatchView; meId: Id<"users"> | undefined }) {
  const { online, here } = useHere(player.userId);
  const isMe = player.userId === meId;
  const toMove = match.status === "active" && sideToMove(match) === player.color;
  const winner = match.result && !match.result.draw && match.result.winners.includes(player.userId);
  const ready = match.mode === "chess:realtime" && (match.state as RealtimeState)?.startAt === null && (match.state as RealtimeState)?.ready.includes(player.userId);
  const color = COLOR_NAMES[player.color ?? ""] ?? "";
  return (
    <div className="flex min-h-12 items-center gap-3 px-1">
      <span className="relative shrink-0">
        <PlayerAvatar name={player.name} image={player.image} frame={player.frame} frameColor={player.frameColor} size={36} />
        <span className="absolute -bottom-0.5 -right-0.5 [--dot-ring:var(--background)]">
          <OnlineDot online={online} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {isMe ? "You" : player.name} {player.badge}
        </p>
        <p className="truncate text-footnote text-muted-foreground">{!isMe && here && match.status === "active" ? `${color}, here now` : color}</p>
      </div>
      {/* Fades in where it sits: a chip flying between the bars would cross the board and catch taps. */}
      {toMove &&
        (isMe ? (
          <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", bounce: 0.2, duration: 0.3 }} className="pointer-events-none rounded-full bg-primary px-3.5 py-2 font-display text-callout text-primary-foreground">
            Your move
          </motion.span>
        ) : (
          <span className="pointer-events-none rounded-full bg-muted px-3 py-1.5 text-footnote font-semibold text-muted-foreground">To move</span>
        ))}
      {ready && <Chip tone="quiet">Ready</Chip>}
      {winner && <Chip tone="win">Winner</Chip>}
    </div>
  );
}

const SEAT_ORDER = ["red", "blue", "yellow", "green"];
// Where each army sits on screen, counting clockwise from mine at the bottom, and the empty corner of the
// cross board its player sits in (the one on that army's left).
const SIDES = ["bottom", "left", "top", "right"] as const;
const CORNER: Record<(typeof SIDES)[number], CSSProperties> = {
  bottom: { left: 0, bottom: 0 },
  left: { left: 0, top: 0 },
  top: { right: 0, top: 0 },
  right: { right: 0, bottom: 0 },
};

// Who's out in a real-time four-player game, from the settled snapshot (it trails live play by under a second).
function useRtOut(match: MatchView) {
  const rt = useQuery(api.chess.rtState, match.mode === "chess:realtime4" ? { id: match._id } : "skip");
  return ((rt?.snapshot as RtState | null)?.out ?? []).map((o) => o.color);
}

// The four players, each in the empty 3x3 corner next to their own army: avatar, points, who's up, who's out.
function FourSeats({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const rtOut = useRtOut(match);
  const classic = match.mode === "chess:four" ? (match.state as FourState) : null;
  const rt = match.mode === "chess:realtime4" ? (match.state as RealtimeState) : null;
  const myColor = match.players.find((p) => p.userId === meId)?.color ?? "red";
  const base = SEAT_ORDER.indexOf(myColor);
  return (
    <div className="pointer-events-none absolute inset-0" aria-label="Players">
      {match.players.map((p) => {
        const side = SIDES[(SEAT_ORDER.indexOf(p.color!) - base + 4) % 4];
        const out = classic ? classic.out.find((o) => o.color === p.color) : rtOut.includes(p.color!) ? { reason: "king" } : undefined;
        const toMove = match.status === "active" && classic?.turn === p.color;
        const ready = rt && rt.startAt === null && rt.ready.includes(p.userId);
        const winner = match.result?.winners.includes(p.userId);
        return <Seat key={p.userId} player={p} isMe={p.userId === meId} style={CORNER[side]} out={out?.reason} toMove={toMove} ready={!!ready} winner={!!winner} points={classic ? classic.points[p.color as keyof FourState["points"]] : null} />;
      })}
    </div>
  );
}

function Seat({ player: p, isMe, style, out, toMove, ready, winner, points }: { player: Player; isMe: boolean; style: CSSProperties; out?: string; toMove: boolean; ready: boolean; winner: boolean; points: number | null }) {
  const { online } = useHere(p.userId);
  const color = SEAT_COLORS[out ? "dead" : p.color!];
  return (
    <div data-seat={p.color} className="absolute flex h-[21.4%] w-[21.4%] flex-col items-center justify-center gap-0.5 text-center" style={style}>
      <span
        className={cn("relative rounded-full transition-shadow duration-300", out && "opacity-50 grayscale")}
        style={{ boxShadow: toMove ? `0 0 0 2.5px var(--background), 0 0 0 5px ${color}` : undefined }}
      >
        <PlayerAvatar name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={34} />
        <span className="absolute -bottom-0.5 -right-0.5 [--dot-ring:var(--background)]">
          <OnlineDot online={online} />
        </span>
      </span>
      <span className="w-full truncate px-0.5 text-caption font-semibold">{isMe ? "You" : p.name}</span>
      <span className="flex items-center gap-1 text-footnote font-semibold tabular-nums leading-none">
        {winner ? (
          <CrownSimpleIcon size={14} weight="fill" className="text-[var(--tile-yellow)]" aria-label="Winner" />
        ) : (
          <span className="size-2 rounded-full" style={{ background: color }} />
        )}
        {out ? outText(out) : ready ? "Ready" : points !== null ? points : COLOR_NAMES[p.color!]}
      </span>
    </div>
  );
}

// The line under a four-player board: whose move it is, live.
function FourStatus({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const classic = match.mode === "chess:four" ? (match.state as FourState) : null;
  const up = classic && match.status === "active" ? match.players.find((p) => p.color === classic.turn) : undefined;
  const { here } = useHere(up?.userId ?? ("" as Id<"users">));
  if (!up) return match.mode === "chess:four" ? <div className="min-h-12" /> : null;
  return (
    <p className="flex min-h-12 items-center justify-center gap-2 font-display text-heading">
      <span className="size-2.5 rounded-full" style={{ background: SEAT_COLORS[up.color!] }} />
      {up.userId === meId ? "Your move" : here ? `${up.name} is on it` : `Waiting for ${up.name}`}
      {up.userId !== meId && here && <ThinkingDots />}
    </p>
  );
}

function ThinkingDots() {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="size-1.5 rounded-full bg-muted-foreground" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
      ))}
    </span>
  );
}

const outText = (reason: string) => ({ checkmate: "Mated", stalemate: "Stalemated", resign: "Resigned", timeout: "Timed out", king: "King fell" })[reason] ?? "Out";

// The bar at the bottom of a game in progress: draw and resign, each a full-height thumb target.
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
  if (four && alreadyOut) return <p className="py-3 text-center text-callout text-muted-foreground">You're out. Stick around to see who wins.</p>;
  const bar = "h-[60px] flex-col gap-1 rounded-lg bg-card text-footnote [&_svg:not([class*='size-'])]:size-[22px]";
  const resignButton = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary" className={cn(bar, "text-destructive")}>
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
          <AlertDialogCancel>Keep playing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void resign({ id: match._id }).catch((e) => toast.error(errorText(e)))}>
            Resign
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  if (four) return <div className="grid">{resignButton}</div>;
  return (
    <div className="flex flex-col gap-2.5">
      {theyOffered && (
        <div className="flex items-center gap-2 rounded-lg bg-card p-2 pl-4 ring-2 ring-primary/60">
          <HandshakeIcon size={22} weight="fill" className="shrink-0 text-primary" />
          <span className="flex-1 font-semibold">Draw offered</span>
          <AsyncButton size="sm" variant="secondary" onClick={() => declineDraw({ id: match._id })}>
            No
          </AsyncButton>
          <AsyncButton size="sm" onClick={() => offerDraw({ id: match._id })}>
            Accept
          </AsyncButton>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <AsyncButton variant="secondary" className={bar} disabled={iOffered} icon={<HandshakeIcon weight="bold" />} onClick={() => offerDraw({ id: match._id })}>
          {iOffered ? "Draw offered" : "Offer draw"}
        </AsyncButton>
        {resignButton}
      </div>
    </div>
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

function Result({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const r = match.result!;
  const iPlayed = match.players.some((p) => p.userId === meId);
  const four = match.players.length > 2;
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
      {four && r.standings && <Standings match={match} standings={r.standings} meId={meId} />}
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
  const points = match.mode === "chess:four" ? (match.state as FourState).points : null;
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
              {points && <span className="text-footnote tabular-nums text-muted-foreground">{points[p.color as keyof typeof points]} pts</span>}
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

// Waiting for players: who's in, then the actions at the bottom of the screen.
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
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Tiles word="OFF" states={["gray", "gray", "hit"]} size="lg" label="Off" />
          <h2 className="mt-3 font-display text-title">This game was called off</h2>
        </div>
        <Button size="xl" variant="secondary" className="w-full" onClick={onLeave}>
          Back to Play
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
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
        {mode.players > 2 ? <Seats match={match} /> : <PlayerAvatar name={host.name} image={host.image} frame={host.frame} frameColor={host.frameColor} badge={host.badge} size={96} />}
        <h2 className="font-display text-title">{title}</h2>
      </div>
      {isHost ? (
        <div className="grid w-full gap-2">
          <Button size="xl" onClick={() => void shareLink(`/chess/${match._id}?accept=1`, `${mode.name} chess, come play:`)}>
            <ShareNetworkIcon weight="bold" /> Share invite link
          </Button>
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

// The seats of a bigger game: who's in, who's been asked, and what's still open.
function Seats({ match }: { match: MatchView }) {
  const mode = MODES[match.mode as ModeKey];
  const pending = match.invitedPeople.filter((p) => !p.joined);
  const open = Math.max(0, mode.players - match.players.length - pending.length);
  return (
    <ul className="grid w-full grid-cols-4 gap-2" aria-label="Seats">
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
