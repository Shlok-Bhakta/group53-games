import { RESOURCE_NAMES } from "./board";
import type { Dev, Ev } from "./engine";

export const resName = (r: number) => RESOURCE_NAMES[r]?.toLowerCase() ?? "something";

export function handText(h: readonly number[]) {
  const parts = h.flatMap((n, r) => (n > 0 ? [`${n} ${resName(r)}`] : []));
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export const CARD_NAMES: Record<Dev, string> = {
  knight: "Knight",
  roads: "Two roads",
  plenty: "Windfall",
  corner: "Corner the market",
  point: "Monument",
};

export const CARD_TEXT: Record<Dev, string> = {
  knight: "Move the bandit and steal a card. Three knights or more and the most of anyone is the biggest army: 2 points.",
  roads: "Build two roads for free.",
  plenty: "Take any two resources from the bank.",
  corner: "Name a resource. Everyone hands you all of theirs.",
  point: "Worth a point. Kept secret until the end.",
};

const PIECE = { road: "a road", village: "a village", town: "a town" } as const;

type Name = (seat: number) => string;
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

export function say(e: Ev, name: Name): string | null {
  const who = (seat: number) => name(seat);
  const verb = (seat: number, you: string, them: string) => (who(seat) === "you" ? you : them);
  switch (e.t) {
    case "build":
      return cap(`${who(e.seat)} built ${PIECE[e.kind]}.`);
    case "start":
      return cap(`${who(e.seat)} ${verb(e.seat, "start", "starts")} with ${handText(e.got)}.`);
    case "roll":
      return cap(`${who(e.seat)} rolled ${e.dice[0] + e.dice[1]}.`);
    case "gain": {
      const lines = e.got.flatMap((h, i) => (h.some((n) => n) ? [`${who(i)} got ${handText(h)}`] : []));
      return lines.length ? cap(`${lines.join("; ")}.`) : null;
    }
    case "short":
      return `The bank ran short of ${resName(e.r)}, so nobody got any.`;
    case "discard":
      return cap(`${who(e.seat)} gave back ${handText(e.res)}.`);
    case "bandit":
      return cap(`${who(e.seat)} moved the bandit.`);
    case "steal":
      return cap(`${who(e.seat)} stole ${resName(e.r)} from ${who(e.from)}.`);
    case "buy":
      return cap(`${who(e.seat)} bought a card.`);
    case "play":
      if (e.card === "plenty") return cap(`${who(e.seat)} played Windfall for ${handText(e.got ?? [])}.`);
      if (e.card === "corner") return cap(`${who(e.seat)} cornered the market in ${resName(e.r ?? 0)} and took ${e.took ?? 0}.`);
      return cap(`${who(e.seat)} played ${CARD_NAMES[e.card]}.`);
    case "bank":
      return cap(`${who(e.seat)} traded ${e.n} ${resName(e.give)} with the bank for 1 ${resName(e.get)}.`);
    case "offer":
      return cap(
        `${who(e.offer.from)} offered ${e.offer.to >= 0 ? who(e.offer.to) : "anyone"} ${handText(e.offer.give)} for ${handText(e.offer.get)}.`,
      );
    case "traded":
      return cap(`${who(e.by)} took ${who(e.offer.from)}'s ${handText(e.offer.give)} for ${handText(e.offer.get)}.`);
    case "untrade":
      return e.why === "reject" ? cap(`${who(e.by)} turned down ${who(e.offer.from)}'s trade.`) : null;
    case "award":
      if (e.seat < 0) return `Nobody has the ${e.kind === "road" ? "longest road" : "biggest army"} now.`;
      return cap(`${who(e.seat)} ${verb(e.seat, "have", "has")} the ${e.kind === "road" ? "longest road" : "biggest army"}.`);
    case "turn":
      return null;
    case "out":
      return cap(`${who(e.seat)} left the game.`);
    case "win":
      return cap(`${who(e.seat)} won with ${e.points} points.`);
  }
}
