import { addDays } from "./days";

type Scored = { score: number; at: number };

export function ranked<T extends Scored>(rows: T[]): (T & { place: number })[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.at - b.at);
  return sorted.map((r) => ({ ...r, place: sorted.findIndex((s) => s.score === r.score) + 1 }));
}

type Posted = Scored & { userId: string; game: string; day: string; puzzle?: number };

export const roundKey = (r: { game: string; day: string; puzzle?: number }) => `${r.game}|${r.day}|${r.puzzle ?? ""}`;

function crownsOf(rows: Posted[]) {
  const rounds = new Map<string, Posted[]>();
  for (const r of rows) rounds.set(roundKey(r), [...(rounds.get(roundKey(r)) ?? []), r]);
  const crowns = new Map<string, number>();
  for (const round of rounds.values()) {
    if (round.length < 2) continue;
    for (const r of ranked(round)) if (r.place === 1) crowns.set(r.userId, (crowns.get(r.userId) ?? 0) + 1);
  }
  return crowns;
}

export function streakOf(days: Set<string>, today: string) {
  let day = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function board(rows: Posted[], today: string, since: string) {
  const recent = rows.filter((r) => r.day >= since);
  const crowns = crownsOf(recent);
  const byUser = new Map<string, Posted[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  return [...byUser.entries()]
    .map(([userId, mine]) => ({
      userId,
      crowns: crowns.get(userId) ?? 0,
      played: mine.filter((r) => r.day >= since).length,
      streak: streakOf(new Set(mine.map((r) => r.day)), today),
    }))
    .filter((p) => p.played > 0 || p.streak > 0)
    .sort((a, b) => b.crowns - a.crowns || b.played - a.played || b.streak - a.streak);
}
