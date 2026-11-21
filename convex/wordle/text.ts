import { ITEMS, type Buy, type WordleState } from "./engine";

const VERB: Record<string, string> = {
  fog: "fogged",
  fuse: "shortened the fuse on",
  jam: "jammed",
  pickpocket: "pickpocketed",
  dark: "blacked out",
  tax: "taxed",
};

export function buyLine(b: Buy, name: (seat: number) => string): string {
  const who = name(b.seat);
  const item = ITEMS[b.item];
  if (!b.got) return `${who} wanted ${item.name}, but it sold out first`;
  if (!item.target) return `${who} bought ${item.name}`;
  const them = name(b.target);
  if (b.blocked) return `${who}'s ${item.name} bounced off ${them === "you" ? "your" : `${them}'s`} shield`;
  if (b.item === "pickpocket") return `${who} took ${b.took ?? 0} coin${b.took === 1 ? "" : "s"} from ${them}`;
  return `${who} ${VERB[b.item]} ${them}`;
}

export function hitsOn(buys: Buy[], seat: number) {
  return buys.filter((b) => b.got && b.target === seat && b.seat !== seat);
}

export function roundPush(s: WordleState, seat: number, buys: Buy[], names: string[]) {
  const name = (i: number) => (i === seat ? "you" : names[i]);
  const lines = hitsOn(buys, seat).map((b) => buyLine(b, name));
  const missed = [...new Set(buys.filter((b) => b.seat === seat && !b.got).map((b) => ITEMS[b.item].name))];
  if (missed.length) lines.push(`${missed.join(" and ")} sold out before your turn to buy`);
  const body = lines.length ? `${cap(lines.join(". "))}.` : `You've solved ${s.players[seat].solved} of ${s.rules.goal}.`;
  return { title: `Word ${s.round + 1} is up`, body };
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
