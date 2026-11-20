import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import { ArrowSquareOutIcon, ClockCounterClockwiseIcon, CrownSimpleIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { addDays } from "../../../convex/daily/days";
import { DAILY_GAMES, dailyPath, findDailyGame, type DailyGame } from "../../../convex/daily/games";
import { NavBar } from "@/components/AppHeader";
import { Group, Section } from "@/components/parts";
import { ListRow } from "@/components/ListRow";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PasteButton } from "./Paste";
import { Standings, useFaces } from "./Standings";
import { useToday } from "./today";

function useMe() {
  return useQuery(api.users.me)?._id;
}

function dayLabel(day: string, today: string) {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const roundTitle = (game: DailyGame, puzzle: number | null) => (puzzle === null ? game.name : `${game.name} #${puzzle}`);

function PlayLink({ game }: { game: DailyGame }) {
  return (
    <Button size="icon" variant="ghost" asChild>
      <a href={game.url} target="_blank" rel="noreferrer" aria-label={`Play ${game.name}`}>
        <ArrowSquareOutIcon weight="bold" />
      </a>
    </Button>
  );
}

type BoardRow = { userId: string; crowns: number; played: number; streak: number };

function Board({ label, rows, meId }: { label: string; rows: BoardRow[]; meId: Id<"users"> | undefined }) {
  const faces = useFaces();
  return (
    <ol data-slot="card" aria-label={label} className="divide-y divide-border overflow-hidden rounded-lg bg-card">
      {rows.map((r) => {
        const face = faces.get(r.userId);
        const detail = [`${r.played} played`, r.streak > 1 ? `${r.streak}-day streak` : null].filter(Boolean).join(", ");
        return (
          <li key={r.userId}>
            <ListRow
              selected={r.userId === meId}
              leading={<PlayerAvatar player={face} name={face?.name ?? "Player"} size={34} />}
              title={r.userId === meId ? "You" : (face?.name ?? "Player")}
              detail={detail}
              trailing={
                <span className="flex items-center gap-1.5 font-display text-heading tabular-nums" aria-label={`${r.crowns} crowns`}>
                  <CrownSimpleIcon weight="fill" className="size-5 text-[var(--tile-yellow)]" />
                  {r.crowns}
                </span>
              }
            />
          </li>
        );
      })}
    </ol>
  );
}

export function Daily() {
  const day = useToday();
  const meId = useMe();
  const rounds = useQuery(api.daily.today, { day });
  const week = useQuery(api.daily.week, { day });
  const mine = new Map((rounds ?? []).flatMap((r) => r.entries.filter((e) => e.userId === meId).map((e) => [r.game, e.display])));
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <NavBar title="Dailies" />
        <PasteButton />
      </div>
      {rounds === undefined && <Skeleton className="h-40 rounded-lg" />}
      {rounds?.map((r) => {
        const game = findDailyGame(r.game);
        if (!game) return null;
        return (
          <Section
            key={`${r.game}:${r.puzzle}`}
            title={roundTitle(game, r.puzzle)}
            bare
            action={
              <Button variant="ghost" size="sm" className="-mr-2 -mb-2.5" asChild>
                <Link to={dailyPath(game.key)}>History</Link>
              </Button>
            }
          >
            <Standings label={`${game.name} today`} entries={r.entries} meId={meId} removable />
          </Section>
        );
      })}
      {week && week.length > 0 && (
        <Section title="This week" bare>
          <Board label="This week" rows={week} meId={meId} />
        </Section>
      )}
      <Section title="Play">
        {DAILY_GAMES.map((g) => (
          <ListRow
            key={g.key}
            title={g.name}
            detail={g.blurb}
            trailing={
              <span className="-mr-2 flex items-center">
                {mine.has(g.key) && <span className="pr-1 font-display text-body tabular-nums">{mine.get(g.key)}</span>}
                <Button size="icon" variant="ghost" asChild>
                  <Link to={dailyPath(g.key)} aria-label={`${g.name} history`}>
                    <ClockCounterClockwiseIcon weight="bold" />
                  </Link>
                </Button>
                <PlayLink game={g} />
              </span>
            }
          />
        ))}
      </Section>
    </div>
  );
}

export function DailyHistory() {
  const { game: key = "" } = useParams();
  const game = findDailyGame(key);
  const day = useToday();
  const meId = useMe();
  const history = useQuery(api.daily.history, game ? { game: game.key, day } : "skip");
  if (!game)
    return (
      <div className="flex flex-col gap-5">
        <NavBar title="Dailies" back="/daily" />
        <p className="text-callout text-muted-foreground">There's no daily called that.</p>
      </div>
    );
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <NavBar title={game.name} back="/daily" action={<PlayLink game={game} />} />
        <PasteButton />
      </div>
      {history === undefined && <Skeleton className="h-40 rounded-lg" />}
      {history && history.board.length > 0 && (
        <Section title="Last 30 days" bare>
          <Board label="Last 30 days" rows={history.board} meId={meId} />
        </Section>
      )}
      {history?.days.map((r) => (
        <Section
          key={`${r.day}:${r.puzzle}`}
          title={r.puzzle === null ? dayLabel(r.day, day) : `${dayLabel(r.day, day)} · #${r.puzzle}`}
          bare
        >
          <Standings label={`${game.name} ${dayLabel(r.day, day)}`} entries={r.entries} meId={meId} removable={r.day === day} />
        </Section>
      ))}
      {history && history.days.length === 0 && (
        <Group>
          <ListRow title={game.name} detail={game.blurb} trailing={<PlayLink game={game} />} />
        </Group>
      )}
    </div>
  );
}
