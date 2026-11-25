import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ChartLineUpIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { motion } from "motion/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MODES, MODE_KEYS, modePath, type ModeKey } from "../../convex/modes";
import { LargeTitle } from "@/components/AppHeader";
import { ListRow } from "@/components/ListRow";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerCard } from "@/components/PlayerCard";
import { Group, RankTile, Section, fullModeLabel } from "@/components/parts";
import { Button } from "@/components/ui/button";
import { DrawerDescription } from "@/components/ui/drawer";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { lastSeenText, usePresence } from "@/presence";

type Rated = { mode: string; userId: Id<"users">; rating: number; games: number; wins: number; losses: number; draws: number };

export function Crew() {
  const me = useQuery(api.users.me);
  const crew = useQuery(api.profiles.crew);
  const rated = useQuery(api.ratings.crew);
  const { isOnline, byUser } = usePresence();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<Id<"users"> | null>(null);
  const show = (id: Id<"users">) => (id === me?._id ? navigate("/you") : setOpenId(id));

  const sorted =
    crew &&
    [...crew].sort(
      (a, b) =>
        Number(isOnline(b._id)) - Number(isOnline(a._id)) ||
        Number(b._id === me?._id) - Number(a._id === me?._id) ||
        a.joinedAt - b.joinedAt,
    );
  const open = crew?.find((p) => p._id === openId) ?? null;

  return (
    <div className="flex flex-col gap-7">
      <LargeTitle title="Crew" />

      <section aria-label="Cards" className="-mt-2">
        {sorted === undefined ? (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-[3/4] rounded-lg" />
            ))}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {sorted.map((p) => (
              <motion.li key={p._id} layout transition={{ type: "spring", bounce: 0, duration: 0.4 }}>
                <Button variant="bare" size="card" onClick={() => show(p._id)}>
                  <PlayerCard player={p} online={isOnline(p._id)} />
                </Button>
              </motion.li>
            ))}
          </ul>
        )}
      </section>

      {crew && rated && <Ratings rated={rated} crew={crew} meId={me?._id} />}

      <Sheet open={open !== null} onClose={() => setOpenId(null)} title={open?.name} hideTitle bodyClassName="px-5">
        {open && (
          <div className="mx-auto w-full max-w-sm pt-3">
            <PlayerCard player={open} online={isOnline(open._id)} size="hero" />
            <DrawerDescription className="mt-4 text-center">
              {lastSeenText(isOnline(open._id), byUser.get(open._id)?.lastSeen)}
            </DrawerDescription>
            {rated && <TheirRatings rated={rated.filter((r) => r.userId === open._id)} />}
            <Button size="xl" variant="secondary" className="mt-4 w-full" asChild>
              <Link to={`/stonks/u/${open._id}`}>
                <ChartLineUpIcon weight="bold" /> Stonks profile
              </Link>
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function record(mode: ModeKey, r: Rated) {
  if (MODES[mode].players > 2) return `${r.wins} won of ${r.games}`;
  return `${r.wins} won, ${r.losses} lost${r.draws ? `, ${r.draws} drawn` : ""}`;
}

function byMode(rated: Rated[]) {
  return MODE_KEYS.map((mode) => ({ mode, rows: rated.filter((r) => r.mode === mode) })).filter((m) => m.rows.length > 0);
}

function Ratings({ rated, crew, meId }: { rated: Rated[]; crew: { _id: Id<"users">; name: string }[]; meId?: Id<"users"> }) {
  const modes = byMode(rated);
  if (modes.length === 0) return null;
  const people = new Map(crew.map((p) => [p._id, p]));
  return (
    <Section title="Ratings">
      {modes.map(({ mode, rows }) => {
        const leader = rows[0];
        const face = people.get(leader.userId);
        const myRank = rows.findIndex((r) => r.userId === meId) + 1;
        const mine = rows[myRank - 1];
        return (
          <ListRow
            key={mode}
            to={modePath(mode)}
            leading={<PlayerAvatar player={face} name={face?.name ?? "Player"} size={34} />}
            title={fullModeLabel(mode)}
            detail={
              leader.userId === meId ? (
                "You lead"
              ) : (
                <span className="flex min-w-0 tabular-nums">
                  <span className="truncate">{face?.name ?? "Player"}</span>
                  <span className="shrink-0">&nbsp;leads, {leader.rating}</span>
                </span>
              )
            }
            trailing={
              mine ? (
                <span className="flex items-center gap-2.5" aria-label={`You: #${myRank}, ${mine.rating}`}>
                  <RankTile rank={myRank} />
                  <span className="font-display text-heading tabular-nums">{mine.rating}</span>
                </span>
              ) : null
            }
          />
        );
      })}
    </Section>
  );
}

function TheirRatings({ rated }: { rated: Rated[] }) {
  if (rated.length === 0) return null;
  return (
    <Group className="mt-4">
      {byMode(rated).map(({ mode, rows: [r] }) => (
        <ListRow
          key={mode}
          size="sm"
          title={fullModeLabel(mode)}
          detail={<span className="tabular-nums">{record(mode, r)}</span>}
          trailing={<span className="font-display text-heading tabular-nums">{r.rating}</span>}
        />
      ))}
    </Group>
  );
}
