import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { SwordIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import type { ClassicState } from "../../../convex/chess";
import type { FourState } from "../../../convex/chess/four/classic";
import { MODES, type ModeKey } from "../../../convex/modes";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { cn } from "@/lib/utils";
import { AsyncButton } from "@/components/AsyncButton";
import { listNames, ordinal, reasonText } from "./text";

// A mode's one name, the same everywhere: "Classic", "4-Player", "Real-time", "Real-time 4-Player".
export const modeLabel = (mode: string) => MODES[mode as ModeKey]?.name ?? mode;

// A titled group of rows. The heading carries the section; the group is a single flat surface.
export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="flex items-end justify-between px-1 pb-2.5">
        <h2 className="font-display text-heading">{title}</h2>
        {action}
      </div>
      <Group>{children}</Group>
    </section>
  );
}

export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-border overflow-hidden rounded-lg bg-card", className)}>{children}</div>;
}

// Small status label at the end of a row.
export function Chip({ tone = "primary", children }: { tone?: "primary" | "live" | "win" | "quiet"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-footnote font-bold",
        tone === "primary" && "bg-primary text-primary-foreground",
        tone === "live" && "bg-[var(--tile-hit)] text-[var(--tile-hit-ink)]",
        tone === "win" && "bg-[var(--tile-green)] text-[var(--tile-ink)]",
        tone === "quiet" && "px-0 font-medium text-muted-foreground",
      )}
    >
      {tone === "live" && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const ago = (at: number) => {
  const mins = Math.max(1, Math.round((Date.now() - at) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

// The line under a game's names: its mode, the last move, and how long ago.
function detail(match: MatchView) {
  const parts: string[] = [modeLabel(match.mode)];
  const seats = MODES[match.mode as ModeKey]?.players ?? 2;
  if (match.status === "waiting") {
    if (seats > 2) parts.push(`${match.players.length} of ${seats} in`);
    return parts.join(", ");
  }
  if (match.status === "active") {
    if (match.mode === "chess:classic") {
      const last = (match.state as ClassicState).moves.at(-1);
      if (last) parts.push(last.san);
    } else if (match.mode === "chess:four") {
      const last = (match.state as FourState).moves.at(-1);
      if (last) parts.push(last.text);
    }
    if (MODES[match.mode as ModeKey]?.kind === "async") parts.push(ago(match.lastActivityAt));
  }
  return parts.join(", ");
}

// One game in a list. Shows the other players (or everyone, for games you're watching), and a status.
export function MatchRow({ match, meId, status, vs }: { match: MatchView; meId?: Id<"users">; status: ReactNode; vs?: boolean }) {
  const others = vs ? match.players : match.players.filter((p) => p.userId !== meId);
  const label = others.map((p) => p.name).join(vs && others.length === 2 ? " vs " : ", ");
  const stacked = others.length > 1;
  return (
    <Link to={`/chess/${match._id}`} className="flex min-h-16 items-center gap-3 px-4 py-2.5 transition-colors active:bg-muted">
      <span className="flex shrink-0 -space-x-2.5">
        {others.slice(0, 3).map((p) => (
          <PlayerAvatar key={p.userId} name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={stacked ? 32 : 40} className="rounded-full ring-2 ring-card" />
        ))}
        {others.length === 0 && <span className="grid size-10 place-items-center rounded-full border-2 border-dashed border-muted-foreground/40" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{label || "Open seat"}</span>
        <span className="block truncate text-footnote text-muted-foreground">{detail(match)}</span>
      </span>
      {status}
    </Link>
  );
}

export function TurnChip({ match, meId }: { match: MatchView; meId?: Id<"users"> }) {
  if (MODES[match.mode as ModeKey]?.kind === "realtime") return <Chip tone="live">Live</Chip>;
  if (match.turn === meId) return <Chip>Your move</Chip>;
  const who = match.players.find((p) => p.userId === match.turn);
  return <Chip tone="quiet">{match.players.length > 2 && who ? `${who.name}'s move` : "Their move"}</Chip>;
}

export function ResultChip({ match, meId }: { match: MatchView; meId?: Id<"users"> }) {
  const r = match.result;
  if (!r) return null;
  const mine = !!meId && match.players.some((p) => p.userId === meId);
  if (mine && !r.draw && r.winners.includes(meId!)) return <Chip tone="win">Won</Chip>;
  if (mine) {
    const place = r.standings?.findIndex((g) => g.includes(meId!)) ?? -1;
    return <Chip tone="quiet">{r.draw ? "Draw" : place > 0 ? ordinal(place + 1) : "Lost"}</Chip>;
  }
  const winners = match.players.filter((p) => r.winners.includes(p.userId)).map((p) => p.name);
  return (
    <span className="max-w-[40%] truncate text-right text-footnote font-medium text-muted-foreground" title={reasonText(r.reason, match.mode)}>
      {r.draw ? "Draw" : `${listNames(winners)} won`}
    </span>
  );
}

// A challenge waiting on me, answerable in place.
export function InviteCard({ match }: { match: MatchView }) {
  const join = useMutation(api.matches.join);
  const decline = useMutation(api.matches.decline);
  const navigate = useNavigate();
  const host = match.players.find((p) => p.userId === match.createdBy) ?? match.players[0];
  const m = MODES[match.mode as ModeKey];
  const alsoAsked = match.invitedPeople.length - 1;
  return (
    <motion.section
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", bounce: 0, duration: 0.3 }}
      className="flex flex-col gap-3 rounded-lg bg-card p-3.5 ring-2 ring-primary/60"
      aria-label={`Challenge from ${host.name}`}
    >
      <div className="flex items-center gap-3">
        <PlayerAvatar name={host.name} image={host.image} frame={host.frame} frameColor={host.frameColor} size={44} />
        <p className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{host.name} challenged you</span>
          <span className="block truncate text-footnote text-muted-foreground">
            {modeLabel(match.mode)}
            {m.players > 2 && alsoAsked > 0 ? `, with ${alsoAsked} other${alsoAsked > 1 ? "s" : ""}` : ""}
          </span>
        </p>
      </div>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <AsyncButton size="lg" variant="secondary" onClick={() => decline({ id: match._id })}>
          Decline
        </AsyncButton>
        <AsyncButton
          size="lg"
          icon={<SwordIcon weight="bold" />}
          onClick={async () => {
            await join({ id: match._id });
            navigate(`/chess/${match._id}`);
          }}
        >
          Accept
        </AsyncButton>
      </div>
    </motion.section>
  );
}

// Rank as a letter tile: gold, green, then grey. No games yet reads as a dash.
export function RankTile({ rank }: { rank: number | null }) {
  if (!rank) return <span className="w-[30px] shrink-0 text-center font-display text-body text-muted-foreground">–</span>;
  const tone = rank === 1 ? "tile-yellow" : rank === 2 ? "tile-green" : "tile-gray";
  return (
    <span className={cn("tile shrink-0", tone)} style={{ width: 30, height: 30, borderRadius: 8, fontSize: 15 }}>
      {rank}
    </span>
  );
}

export function Leaderboard({ mode, meId, onPick }: { mode: ModeKey; meId?: Id<"users">; onPick?: (userId: Id<"users">) => void }) {
  const rows = useQuery(api.ratings.leaderboard, { mode });
  const crew = useQuery(api.profiles.crew);
  if (!rows || !crew) return <Group className="h-[232px]">{null}</Group>;
  const people = new Map(crew.map((p) => [p._id, p]));
  const four = MODES[mode].players > 2;
  let rank = 0;
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-lg bg-card" aria-label={`${modeLabel(mode)} leaderboard`}>
      {rows.map((r) => {
        const p = people.get(r.userId);
        if (!p) return null;
        const ranked = r.games > 0;
        if (ranked) rank++;
        const inner = (
          <>
            <RankTile rank={ranked ? rank : null} />
            <PlayerAvatar name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{r.userId === meId ? "You" : p.name}</span>
              <span className="block text-footnote tabular-nums text-muted-foreground">
                {!ranked ? "No games yet" : four ? `${r.wins} won of ${r.games}` : `${r.wins} won, ${r.losses} lost${r.draws ? `, ${r.draws} drawn` : ""}`}
              </span>
            </span>
            <span className={cn("font-display text-heading tabular-nums", !ranked && "text-muted-foreground")}>{r.rating}</span>
          </>
        );
        const cls = cn("flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left", r.userId === meId && "bg-primary/8");
        return (
          <li key={r.userId}>
            {onPick ? (
              <button type="button" className={cn(cls, "touch-manipulation transition-colors active:bg-muted")} onClick={() => onPick(r.userId)}>
                {inner}
              </button>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
