import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { ArrowLeftIcon, CaretRightIcon, MagnifyingGlassIcon, SwordIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import { MODES, modeBySlug } from "../../../convex/modes";
import { BackHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AsyncButton } from "@/components/AsyncButton";
import { Rules } from "./Rules";
import { ChallengeSheet, Leaderboard, MatchRow, ResultChip, Section, TurnChip } from "./parts";

// One mode: start or join a game, your games in it, games to watch, and its leaderboard. Challenges to you
// live in the inbox (home screen and /chess), not here.
export function ModePage() {
  const { slug } = useParams<{ slug: string }>();
  const mode = modeBySlug(slug ?? "");
  const lobby = useQuery(api.matches.lobby, mode ? { mode } : "skip");
  const me = useQuery(api.users.me);
  const ratings = useQuery(api.ratings.mine);
  const queue = useMutation(api.matches.queue);
  const navigate = useNavigate();
  const [challenging, setChallenging] = useState(false);
  if (!mode) return <Navigate to="/chess" replace />;
  const info = MODES[mode];
  const seats = info.players;

  const find = async () => {
    const id = await queue({ mode });
    navigate(`/chess/${id}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <BackHeader
        title={info.title[0].toUpperCase() + info.title.slice(1)}
        back={
          <Button variant="ghost" size="icon" asChild aria-label="Back to chess">
            <Link to="/chess">
              <ArrowLeftIcon size={24} weight="bold" />
            </Link>
          </Button>
        }
      />
      <p className="-mt-6 px-1 text-[0.95rem] leading-relaxed text-muted-foreground">{info.blurb}</p>

      {lobby === undefined || lobby === null ? (
        <Skeleton className="h-40 rounded-3xl" />
      ) : (
        <>
          {lobby.waiting.length > 0 ? (
            <Link to={`/chess/${lobby.waiting[0]._id}`} className="flex items-center gap-3 rounded-3xl border-2 border-dashed border-primary/50 bg-primary/5 p-4">
              <motion.span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground" animate={{ rotate: [0, 12, -12, 0] }} transition={{ duration: 1.8, repeat: Infinity }}>
                <MagnifyingGlassIcon size={22} weight="bold" />
              </motion.span>
              <span className="flex-1">
                <span className="block font-semibold">
                  {seats > 2 ? `${lobby.waiting[0].players.length}/${seats} seats filled` : lobby.waiting[0].invited.length ? "Challenge sent" : "Looking for an opponent"}
                </span>
                <span className="block text-sm text-muted-foreground">{lobby.waiting[0].createdBy === me?._id ? "Tap to share or cancel" : "Tap to see who's in"}</span>
              </span>
              <CaretRightIcon size={18} weight="bold" className="text-muted-foreground" />
            </Link>
          ) : (
            <div className="grid grid-cols-[1fr_auto] gap-2.5">
              <AsyncButton size="xl" onClick={find} icon={<MagnifyingGlassIcon weight="bold" />}>
                {lobby.open.length ? "Join a game" : "Find a game"}
              </AsyncButton>
              <Button size="xl" variant="secondary" onClick={() => setChallenging(true)}>
                <SwordIcon weight="bold" /> Challenge
              </Button>
            </div>
          )}

          {ratings && <Rules mode={mode} defaultOpen={!ratings[mode]?.games} />}

          {lobby.open.length > 0 && (
            <Section title={seats > 2 ? "Open seats" : "Waiting for an opponent"}>
              {lobby.open.map((m) => (
                <MatchRow key={m._id} match={m} meId={me?._id} status={<span className="text-sm font-semibold text-primary">Join</span>} />
              ))}
            </Section>
          )}

          {lobby.mine.length > 0 && (
            <Section title="Your games">
              {lobby.mine.map((m) => (
                <MatchRow key={m._id} match={m} meId={me?._id} status={<TurnChip match={m} meId={me?._id} />} />
              ))}
            </Section>
          )}

          {lobby.live.length > 0 && (
            <Section title="Happening now">
              {lobby.live.map((m) => (
                <MatchRow key={m._id} match={m} meId={me?._id} status={<span className="text-sm text-muted-foreground">Watch</span>} vs />
              ))}
            </Section>
          )}

          <Leaderboard mode={mode} meId={me?._id} />

          {lobby.recent.length > 0 && (
            <Section title="Recent games">
              {lobby.recent.slice(0, 5).map((m) => (
                <MatchRow key={m._id} match={m} meId={me?._id} vs status={<ResultChip match={m} meId={me?._id} />} />
              ))}
            </Section>
          )}
        </>
      )}

      <ChallengeSheet open={challenging} onClose={() => setChallenging(false)} mode={mode} meId={me?._id} />
    </div>
  );
}
