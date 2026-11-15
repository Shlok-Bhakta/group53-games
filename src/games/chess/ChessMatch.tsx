import type { CSSProperties, ReactNode } from "react";
import { useQuery, useMutation } from "convex/react";
import { motion } from "motion/react";
import { CrownSimpleIcon, HandshakeIcon } from "@phosphor-icons/react";
import { Chess } from "chess.js";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ClassicState, FourState, RealtimeState } from "../../../convex/chess";
import type { State as RtState } from "../../../convex/chess/realtime";
import type { MatchView } from "../../../convex/matches";
import { MODES, type ModeKey } from "../../../convex/modes";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { AsyncButton } from "@/components/AsyncButton";
import { Chip } from "@/components/parts";
import { ResignButton, Result } from "@/components/match";
import { ActionRail, DockNote } from "@/components/game/GameFrame";
import { SeatDot } from "@/components/game/SeatDot";
import { TurnText } from "@/components/game/TurnText";
import { useHere } from "@/presence";
import { seatColor } from "@/games/seats";
import type { Player } from "@/games/types";
import { cn } from "@/lib/utils";
import { ClassicGame } from "./ClassicGame";
import { FourGame } from "./FourGame";
import { RealtimeGame } from "./RealtimeGame";
import type { Dock } from "./dock";
import { COLOR_NAMES } from "./text";

export function ChessGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const mode = MODES[match.mode as ModeKey];
  const four = mode.players > 2;
  const mine = match.players.find((p) => p.userId === meId);
  const opponent = match.players.find((p) => p.userId !== meId) ?? null;

  const seats = four ? <FourSeats match={match} meId={meId} /> : null;
  const top = !four ? <PlayerBar player={opponent ?? match.players[0]} match={match} meId={meId} /> : null;
  const bottom = !four ? (
    <PlayerBar player={mine ?? match.players[1]} match={match} meId={meId} />
  ) : (
    <FourStatus match={match} meId={meId} />
  );
  const dock: Dock = (confirm) =>
    match.status === "finished" ? (
      <Result match={match} meId={meId} />
    ) : mine ? (
      <Controls match={match} meId={meId!} confirm={confirm} />
    ) : (
      <p className="py-3 text-center text-callout text-muted-foreground">You're watching.</p>
    );
  return match.mode === "chess:classic" ? (
    <ClassicGame match={match} meId={meId} above={top} below={bottom} dock={dock} />
  ) : match.mode === "chess:four" ? (
    <FourGame match={match} meId={meId} overlay={seats} below={bottom} dock={dock} />
  ) : (
    <RealtimeGame match={match} meId={meId} above={top} below={bottom} overlay={seats} dock={dock()} />
  );
}

function sideToMove(match: MatchView) {
  if (match.mode !== "chess:classic") return null;
  return new Chess((match.state as ClassicState).fen).turn();
}

function PlayerBar({ player, match, meId }: { player: Player; match: MatchView; meId: Id<"users"> | undefined }) {
  const { online, here } = useHere(player.userId);
  const isMe = player.userId === meId;
  const toMove = match.status === "active" && sideToMove(match) === player.color;
  const winner = match.result && !match.result.draw && match.result.winners.includes(player.userId);
  const ready =
    match.mode === "chess:realtime" &&
    (match.state as RealtimeState)?.startAt === null &&
    (match.state as RealtimeState)?.ready.includes(player.userId);
  const color = COLOR_NAMES[player.color ?? ""] ?? "";
  return (
    <div className="flex min-h-12 items-center gap-3 px-1">
      <PlayerAvatar player={player} size={36} online={online} dotRing="background" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {isMe ? "You" : player.name} {player.badge}
        </p>
        <p className="truncate text-footnote text-muted-foreground">
          {!isMe && here && match.status === "active" ? `${color}, here now` : color}
        </p>
      </div>
      {toMove &&
        (isMe ? (
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
            className="pointer-events-none rounded-full bg-primary px-3.5 py-2 font-display text-callout text-primary-foreground"
          >
            Your move
          </motion.span>
        ) : (
          <span className="pointer-events-none rounded-full bg-muted px-3 py-1.5 text-footnote font-semibold text-muted-foreground">
            To move
          </span>
        ))}
      {ready && <Chip tone="quiet">Ready</Chip>}
      {winner && <Chip tone="win">Winner</Chip>}
    </div>
  );
}

const SEAT_ORDER = ["red", "blue", "yellow", "green"];
const SIDES = ["bottom", "left", "top", "right"] as const;
const CORNER: Record<(typeof SIDES)[number], CSSProperties> = {
  bottom: { left: 0, bottom: 0 },
  left: { left: 0, top: 0 },
  top: { right: 0, top: 0 },
  right: { right: 0, bottom: 0 },
};

function useRtOut(match: MatchView) {
  const rt = useQuery(api.chess.rtState, match.mode === "chess:realtime4" ? { id: match._id } : "skip");
  return ((rt?.snapshot as RtState | null)?.out ?? []).map((o) => o.color);
}

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
        return (
          <Seat
            key={p.userId}
            player={p}
            isMe={p.userId === meId}
            style={CORNER[side]}
            out={out?.reason}
            toMove={toMove}
            ready={!!ready}
            winner={!!winner}
            points={classic ? classic.points[p.color as keyof FourState["points"]] : null}
          />
        );
      })}
    </div>
  );
}

function Seat({
  player: p,
  isMe,
  style,
  out,
  toMove,
  ready,
  winner,
  points,
}: {
  player: Player;
  isMe: boolean;
  style: CSSProperties;
  out?: string;
  toMove: boolean;
  ready: boolean;
  winner: boolean;
  points: number | null;
}) {
  const { online } = useHere(p.userId);
  const color = seatColor(p, !!out);
  return (
    <div
      data-seat={p.color}
      className="absolute flex h-[21.4%] w-[21.4%] flex-col items-center justify-center gap-0.5 text-center"
      style={style}
    >
      <span
        className={cn("relative flex rounded-full transition-shadow duration-300", out && "opacity-50 grayscale")}
        style={{ boxShadow: toMove ? `0 0 0 2.5px var(--background), 0 0 0 5px ${color}` : undefined }}
      >
        <PlayerAvatar player={p} size={34} online={online} dotRing="background" />
      </span>
      <span className="w-full truncate px-0.5 text-caption font-semibold">{isMe ? "You" : p.name}</span>
      <span className="flex items-center gap-1 text-footnote font-semibold tabular-nums leading-none">
        {winner ? (
          <CrownSimpleIcon size={14} weight="fill" className="text-[var(--tile-yellow)]" aria-label="Winner" />
        ) : (
          <SeatDot color={color} />
        )}
        {out ? outText(out) : ready ? "Ready" : points !== null ? points : COLOR_NAMES[p.color!]}
      </span>
    </div>
  );
}

function FourStatus({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const classic = match.mode === "chess:four" ? (match.state as FourState) : null;
  const up = classic && match.status === "active" ? match.players.find((p) => p.color === classic.turn) : undefined;
  if (!up) return match.mode === "chess:four" ? <div className="min-h-12" /> : null;
  return (
    <p className="flex min-h-12 items-center justify-center gap-2 font-display text-heading">
      <SeatDot color={seatColor(up)} size="md" />
      <TurnText up={up} meId={meId} />
    </p>
  );
}

const outText = (reason: string) =>
  ({ checkmate: "Mated", stalemate: "Stalemated", resign: "Resigned", timeout: "Timed out", king: "King fell" })[reason] ?? "Out";

function Controls({ match, meId, confirm }: { match: MatchView; meId: Id<"users">; confirm?: ReactNode }) {
  const offerDraw = useMutation(api.matches.offerDraw);
  const declineDraw = useMutation(api.matches.declineDraw);
  const rtOut = useRtOut(match);
  const four = match.players.length > 2;
  const myColor = match.players.find((p) => p.userId === meId)?.color;
  const alreadyOut =
    match.mode === "chess:four" ? (match.state as FourState).out.some((o) => o.color === myColor) : rtOut.includes(myColor ?? "");
  const theyOffered = match.drawOffer && match.drawOffer !== meId;
  const iOffered = match.drawOffer === meId;
  if (four && alreadyOut) return <DockNote>You're out. Stick around to see who wins.</DockNote>;
  const resignButton = (
    <ResignButton
      match={match}
      variant="card"
      size="dock"
      detail={
        four
          ? "Your army turns grey and the others play on. You keep your place for how long you lasted."
          : "Your opponent gets the win and the rating points."
      }
    />
  );
  if (four) return confirm ?? <ActionRail>{resignButton}</ActionRail>;
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
      {confirm ?? (
        <ActionRail className="gap-2.5">
          <AsyncButton
            variant="card"
            size="dock"
            disabled={iOffered}
            icon={<HandshakeIcon weight="bold" />}
            onClick={() => offerDraw({ id: match._id })}
          >
            {iOffered ? "Draw offered" : "Offer draw"}
          </AsyncButton>
          {resignButton}
        </ActionRail>
      )}
    </div>
  );
}
