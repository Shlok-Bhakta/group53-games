import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { CaretRightIcon, CheckIcon, SpinnerGapIcon, SwordIcon, TrophyIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { MODES, type ModeKey } from "../../../convex/modes";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { OnlineDot, usePresence } from "@/presence";
import { cn } from "@/lib/utils";
import { AsyncButton, usePending } from "@/components/AsyncButton";
import { listNames, reasonText } from "./text";

// Short mode label for lists that mix modes: "Classic", "4-Player", "Real-time", "4-Player real-time".
export const modeLabel = (mode: string) => {
  const m = MODES[mode as ModeKey];
  if (!m) return mode;
  return m.kind === "realtime" && m.players > 2 ? "4-Player real-time" : m.name;
};

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="flex items-end justify-between px-1 pb-2">
        <h2 className="text-[13px] font-semibold text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="divide-y overflow-hidden rounded-2xl border bg-card">{children}</div>
    </section>
  );
}

export function MatchRow({ match, meId, status, vs, showMode }: { match: MatchView; meId?: Id<"users">; status: ReactNode; vs?: boolean; showMode?: boolean }) {
  const others = vs ? match.players : match.players.filter((p) => p.userId !== meId);
  const label = others.map((p) => p.name).join(vs && others.length === 2 ? " vs " : ", ");
  const seats = MODES[match.mode as ModeKey]?.players ?? 2;
  const filling = match.status === "waiting" && seats > 2;
  return (
    <Link to={`/chess/${match._id}`} className="flex min-h-16 items-center gap-3 px-4 py-2.5 active:bg-muted">
      <span className="flex -space-x-2.5">
        {others.slice(0, 3).map((p) => (
          <PlayerAvatar key={p.userId} name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={36} className="rounded-full ring-2 ring-card" />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label || "Open seat"}</span>
        {(showMode || filling) && (
          <span className="block truncate text-xs text-muted-foreground">
            {showMode ? modeLabel(match.mode) : ""}
            {showMode && filling ? " · " : ""}
            {filling ? `${match.players.length}/${seats} seats` : ""}
          </span>
        )}
      </span>
      {status}
      <CaretRightIcon size={16} weight="bold" className="shrink-0 text-muted-foreground/70" />
    </Link>
  );
}

export function TurnChip({ match, meId }: { match: MatchView; meId?: Id<"users"> }) {
  if (MODES[match.mode as ModeKey]?.kind === "realtime") return <span className="rounded-full bg-[var(--tile-hit)] px-2.5 py-1 text-xs font-bold text-[var(--tile-hit-ink)]">Live</span>;
  if (match.turn === meId) return <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">Your move</span>;
  const who = match.players.find((p) => p.userId === match.turn);
  return <span className="max-w-[35%] truncate text-sm text-muted-foreground">{match.players.length > 2 && who ? `${who.name}'s move` : "Their move"}</span>;
}

export function ResultChip({ match, meId }: { match: MatchView; meId?: Id<"users"> }) {
  const r = match.result;
  if (!r) return null;
  const winners = match.players.filter((p) => r.winners.includes(p.userId)).map((p) => p.name);
  const text = r.draw ? "Draw" : `${listNames(winners)} won`;
  const mine = meId && match.players.some((p) => p.userId === meId);
  const tone = r.draw || !mine ? "text-muted-foreground" : r.winners.includes(meId!) ? "text-[var(--tile-green)]" : "text-destructive";
  return (
    <span className={cn("max-w-[40%] truncate text-right text-sm font-semibold", tone)} title={reasonText(r.reason, match.mode)}>
      {text}
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="flex flex-col gap-3 rounded-3xl bg-primary p-4 text-primary-foreground shadow-lg shadow-primary/20"
      aria-label={`Challenge from ${host.name}`}
    >
      <div className="flex items-center gap-3">
        <PlayerAvatar name={host.name} image={host.image} frame={host.frame} frameColor={host.frameColor} size={44} />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="block font-semibold">{host.name} challenged you</span>
          <span className="block text-sm opacity-85">
            {modeLabel(match.mode)}
            {m.players > 2 ? (alsoAsked > 0 ? ` with ${alsoAsked} other${alsoAsked > 1 ? "s" : ""}` : "") : ""}
          </span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <AsyncButton size="lg" className="bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25" onClick={() => decline({ id: match._id })}>
          Decline
        </AsyncButton>
        <AsyncButton
          size="lg"
          className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
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

export function Leaderboard({ mode, meId }: { mode: ModeKey; meId?: Id<"users"> }) {
  const rows = useQuery(api.ratings.leaderboard, { mode });
  const crew = useQuery(api.profiles.crew);
  if (!rows || !crew) return null;
  const people = new Map(crew.map((p) => [p._id, p]));
  const four = MODES[mode].players > 2;
  let rank = 0;
  return (
    <section>
      <h2 className="flex items-center gap-1.5 px-1 pb-2 text-[13px] font-semibold text-muted-foreground">
        <TrophyIcon size={14} weight="fill" /> Leaderboard
      </h2>
      <ol className="divide-y overflow-hidden rounded-2xl border bg-card" aria-label={`${modeLabel(mode)} leaderboard`}>
        {rows.map((r) => {
          const p = people.get(r.userId);
          if (!p) return null;
          const ranked = r.games > 0;
          if (ranked) rank++;
          return (
            <li key={r.userId} className={cn("flex min-h-14 items-center gap-3 px-4 py-2", r.userId === meId && "bg-primary/8")}>
              <span className={cn("w-6 text-center font-display text-lg tabular-nums", rank === 1 && ranked ? "text-[var(--tile-yellow)]" : "text-muted-foreground")}>{ranked ? rank : "–"}</span>
              <PlayerAvatar name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {!ranked ? "No games yet" : four ? `${r.wins} won of ${r.games}` : `${r.wins}W ${r.losses}L ${r.draws}D`}
                </span>
              </span>
              <span className={cn("font-display text-lg tabular-nums", !ranked && "text-muted-foreground")}>{r.rating}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// Pick who to play. Two-player modes send on one tap; four-player lets you pick up to three, and any seats
// you leave empty are open to the rest of the crew.
export function ChallengeSheet({ open, onClose, mode, meId }: { open: boolean; onClose: () => void; mode: ModeKey; meId?: Id<"users"> }) {
  const crew = useQuery(api.profiles.crew);
  const challenge = useMutation(api.matches.challenge);
  const { isOnline } = usePresence();
  const navigate = useNavigate();
  const m = MODES[mode];
  const multi = m.players > 2;
  const max = m.players - 1;
  const others = (crew ?? []).filter((p) => p._id !== meId).sort((a, b) => Number(isOnline(b._id)) - Number(isOnline(a._id)));
  const [pending, run] = usePending();
  const [picked, setPicked] = useState<Id<"users">[]>([]);
  const send = (opponents: Id<"users">[]) =>
    run(async () => {
      const id = await challenge({ mode, opponents });
      onClose();
      setPicked([]);
      navigate(`/chess/${id}`);
    });
  const tap = (id: Id<"users">) => {
    if (!multi) {
      setPicked([id]);
      void send([id]);
      return;
    }
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < max ? [...p, id] : p));
  };
  const free = max - picked.length;
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader>
          <DrawerTitle className="font-display text-xl">{multi ? `Pick up to ${max}` : "Challenge someone"}</DrawerTitle>
          {m.kind === "realtime" && <p className="text-sm text-muted-foreground">Real-time needs everyone on at once. Green means they're on now.</p>}
          {multi && m.kind !== "realtime" && <p className="text-sm text-muted-foreground">Seats you don't fill are open to the rest of the crew.</p>}
        </DrawerHeader>
        <ul className="overflow-y-auto px-4" aria-label="Crew">
          {others.map((p) => {
            const on = picked.includes(p._id);
            return (
              <li key={p._id}>
                <button
                  type="button"
                  disabled={pending}
                  aria-pressed={multi ? on : undefined}
                  aria-busy={pending && on}
                  onClick={() => tap(p._id)}
                  className={cn("flex min-h-16 w-full touch-manipulation items-center gap-3 rounded-2xl px-2 text-left active:bg-muted disabled:opacity-60", on && multi && "bg-primary/10")}
                >
                  <span className="relative">
                    <PlayerAvatar name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={44} />
                    <span className="absolute -bottom-0.5 -right-0.5">
                      <OnlineDot online={isOnline(p._id)} />
                    </span>
                  </span>
                  <span className="flex-1 truncate font-semibold">{p.name}</span>
                  {pending && on ? (
                    <SpinnerGapIcon size={20} weight="bold" className="animate-spin text-muted-foreground" />
                  ) : multi ? (
                    <span className={cn("grid size-7 place-items-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                      {on && <CheckIcon size={16} weight="bold" />}
                    </span>
                  ) : (
                    <SwordIcon size={20} weight="bold" className="text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
          {others.length === 0 && <li className="py-6 text-center text-muted-foreground">Nobody else has signed in yet.</li>}
        </ul>
        {multi ? (
          <DrawerFooter className="pb-[calc(env(safe-area-inset-bottom)+16px)]">
            <Button size="xl" disabled={picked.length === 0 || pending} aria-busy={pending} onClick={() => void send(picked)}>
              {pending ? <SpinnerGapIcon className="animate-spin" weight="bold" /> : <SwordIcon weight="bold" />}
              {picked.length === 0 ? "Pick someone" : free > 0 ? `Challenge ${picked.length}, open ${free} seat${free > 1 ? "s" : ""}` : "Send challenge"}
            </Button>
          </DrawerFooter>
        ) : (
          <div className="pb-[calc(env(safe-area-inset-bottom)+20px)]" />
        )}
      </DrawerContent>
    </Drawer>
  );
}
