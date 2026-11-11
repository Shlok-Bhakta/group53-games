import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { useMutation } from "convex/react";
import { motion } from "motion/react";
import { PlayIcon, ShareNetworkIcon, UserPlusIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { MODES, acceptPath, flexibleSeats, seedSummary, settingsOf, settingsSummary, type ModeKey } from "../../../convex/modes";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ConfirmButton";
import { AsyncButton } from "@/components/AsyncButton";
import { SettingsSection } from "@/components/SettingsPicker";
import { shareLink } from "@/share";
import { errorText } from "@/lib/errors";
import { Tiles } from "@/Tiles";

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
        {mode.players > 2 ? <Seats match={match} /> : <PlayerAvatar player={host} badge={host.badge} size={96} />}
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
          <ConfirmButton
            trigger={
              <Button size="xl" variant="ghost" className="text-destructive">
                Cancel game
              </Button>
            }
            title="Cancel this game?"
            detail={match.players.length > 1 ? "Everyone who's joined is sent back." : "The invite stops working."}
            keep="Keep it"
            confirm="Cancel game"
            onConfirm={() => cancel({ id: match._id }).then(onLeave)}
          />
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
  const seed = seedSummary(mode, match.settings);
  const summary = [...settingsSummary(mode, match.settings), ...(seed ? [seed] : [])];
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
          <PlayerAvatar player={p} size={60} />
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
