import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { CaretRightIcon, CheckIcon, MagnifyingGlassIcon, SpinnerGapIcon, SwordIcon } from "@phosphor-icons/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MODES, flexibleSeats, matchPath, modeBySlug, type ModeKey, type Settings } from "../../convex/modes";
import { NavBar } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { AsyncButton, usePending } from "@/components/AsyncButton";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Rules } from "@/components/Rules";
import { SettingsSection, useModeSettings } from "@/components/SettingsPicker";
import { Chip, Group, Leaderboard, MatchRow, ResultChip, Section, TurnChip } from "@/components/parts";
import type { GameUI } from "@/games";
import { OnlineDot, usePresence } from "@/presence";
import { cn } from "@/lib/utils";

// One mode, as a full page: settings, find a game or challenge people right here, the rules, games in this
// mode, and its leaderboard. Challenges sent to you wait on Home.
export function ModePage({ game }: { game: GameUI }) {
  const { slug } = useParams<{ slug: string }>();
  const mode = modeBySlug(game.key, slug ?? "");
  if (!mode) return <Navigate to={game.path} replace />;
  return <ModeScreen key={mode} game={game} mode={mode} />;
}

function ModeScreen({ game, mode }: { game: GameUI; mode: ModeKey }) {
  const lobby = useQuery(api.matches.lobby, { mode });
  const me = useQuery(api.users.me);
  const ratings = useQuery(api.ratings.mine);
  const queue = useMutation(api.matches.queue);
  const navigate = useNavigate();
  const [settings, setSettings] = useModeSettings(mode);
  const info = MODES[mode];
  const seats = info.players;
  const flexible = flexibleSeats(mode);
  const mine = lobby?.waiting[0];

  return (
    <div className="flex flex-col gap-7">
      <NavBar title={info.name} back={game.path} />

      {lobby === undefined || lobby === null ? (
        <Skeleton className="h-14 rounded-lg" />
      ) : mine ? (
        <Link to={matchPath(mine)} className="flex min-h-16 items-center gap-3 rounded-lg bg-primary/10 px-4 py-3 ring-2 ring-primary/50 transition-transform duration-100 active:scale-[0.98]">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <MagnifyingGlassIcon size={22} weight="bold" />
          </span>
          <span className="flex-1 font-semibold">
            {flexible ? `${mine.players.length} in, waiting to start` : seats > 2 ? `${mine.players.length} of ${seats} in` : mine.invited.length ? "Challenge sent" : "Looking for an opponent"}
          </span>
          <CaretRightIcon size={18} weight="bold" className="text-muted-foreground" />
        </Link>
      ) : (
        <div className="flex flex-col gap-2">
          <AsyncButton
            size="xl"
            className="w-full"
            icon={<MagnifyingGlassIcon weight="bold" />}
            onClick={async () => navigate(matchPath({ _id: await queue({ mode, settings }), mode }))}
          >
            {lobby.open.length ? "Join a game" : flexible ? "Open a game" : "Find a game"}
          </AsyncButton>
          <SettingsSection mode={mode} value={settings} onChange={setSettings} />
        </div>
      )}

      {!mine && <Challenge mode={mode} meId={me?._id} settings={settings} />}

      {ratings && <Rules rules={game.rules(mode, settings)} defaultOpen={!ratings[mode]?.games} />}

      {lobby && lobby.open.length > 0 && (
        <Section title="Open seats">
          {lobby.open.map((m) => (
            <MatchRow key={m._id} match={m} meId={me?._id} status={<Chip>Join</Chip>} />
          ))}
        </Section>
      )}
      {lobby && lobby.mine.length > 0 && (
        <Section title="Your games">
          {lobby.mine.map((m) => (
            <MatchRow key={m._id} match={m} meId={me?._id} status={<TurnChip match={m} meId={me?._id} />} />
          ))}
        </Section>
      )}
      {lobby && lobby.live.length > 0 && (
        <Section title="Happening now">
          {lobby.live.map((m) => (
            <MatchRow key={m._id} match={m} meId={me?._id} vs status={<Chip tone="quiet">Watch</Chip>} />
          ))}
        </Section>
      )}

      <section aria-label="Leaderboard">
        <h2 className="px-1 pb-2.5 font-display text-heading">Leaderboard</h2>
        <Leaderboard mode={mode} meId={me?._id} />
      </section>

      {lobby && lobby.recent.length > 0 && (
        <Section title="Recent games">
          {lobby.recent.slice(0, 5).map((m) => (
            <MatchRow key={m._id} match={m} meId={me?._id} vs status={<ResultChip match={m} meId={me?._id} />} />
          ))}
        </Section>
      )}
    </div>
  );
}

// Challenge people from the crew, right on the page. Two-player modes send on one tap; bigger games let you
// pick several. In fixed-size games the seats you leave empty are open to the crew.
function Challenge({ mode, meId, settings }: { mode: ModeKey; meId?: Id<"users">; settings: Settings }) {
  const crew = useQuery(api.profiles.crew);
  const challenge = useMutation(api.matches.challenge);
  const { isOnline } = usePresence();
  const navigate = useNavigate();
  const [pending, run] = usePending();
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Id<"users">[]>([]);
  const m = MODES[mode];
  const multi = m.players > 2;
  const flexible = flexibleSeats(mode);
  const max = m.players - 1;
  const others = (crew ?? []).filter((p) => p._id !== meId).sort((a, b) => Number(isOnline(b._id)) - Number(isOnline(a._id)) || a.name.localeCompare(b.name));
  if (crew && others.length === 0) return null;

  const send = (opponents: Id<"users">[]) =>
    run(async () => {
      setBusy(opponents.length === 1 && !multi ? opponents[0] : "send");
      try {
        navigate(matchPath({ _id: await challenge({ mode, opponents, settings }), mode }));
      } finally {
        setBusy(null);
      }
    });
  const tap = (id: Id<"users">) => {
    if (!multi) return void send([id]);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < max ? [...p, id] : p));
  };
  const free = max - picked.length;

  return (
    <section aria-label="Challenge" className="flex flex-col gap-2.5">
      <h2 className="px-1 font-display text-heading">Challenge</h2>
      <Group>
        {others.map((p) => {
          const on = picked.includes(p._id);
          return (
            <button
              key={p._id}
              type="button"
              disabled={pending}
              aria-pressed={multi ? on : undefined}
              aria-label={multi ? p.name : `Challenge ${p.name}`}
              onClick={() => tap(p._id)}
              className={cn("flex min-h-16 w-full touch-manipulation items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted disabled:opacity-60", on && "bg-primary/10")}
            >
              <span className="relative shrink-0">
                <PlayerAvatar name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={40} />
                <span className="absolute -bottom-0.5 -right-0.5">
                  <OnlineDot online={isOnline(p._id)} />
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              {busy === p._id ? (
                <SpinnerGapIcon size={20} weight="bold" className="animate-spin text-muted-foreground" />
              ) : multi ? (
                <span className={cn("grid size-7 place-items-center rounded-full border-2 transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                  <AnimatePresence>
                    {on && (
                      <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ type: "spring", bounce: 0.4, duration: 0.3 }}>
                        <CheckIcon size={16} weight="bold" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              ) : (
                <SwordIcon size={20} weight="bold" className="text-muted-foreground" />
              )}
            </button>
          );
        })}
      </Group>
      <AnimatePresence initial={false}>
        {multi && picked.length > 0 && (
          <motion.div key="send" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.3 }} className="overflow-hidden">
            <AsyncButton size="xl" className="mt-0.5 w-full" icon={<SwordIcon weight="bold" />} onClick={() => send(picked)}>
              {flexible ? `Challenge ${picked.length}` : free > 0 ? `Challenge ${picked.length}, open ${free} seat${free > 1 ? "s" : ""}` : "Send challenge"}
            </AsyncButton>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
