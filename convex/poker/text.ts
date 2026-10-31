import type { HandResult, LogEntry } from "./engine";

// How poker moves read, in pushes and on the table. Shared by the server and phones.

// "Chris raised to 200", "Chris went all in", "Chris swapped 2".
export function actionText(e: LogEntry, name: string): string {
  if (e.auto) return `${name} ran out of time`;
  if (e.allIn && e.kind !== "blind") return `${name} went all in`;
  switch (e.kind) {
    case "blind":
      return `${name} posted ${e.amount}`;
    case "fold":
      return `${name} folded`;
    case "check":
      return `${name} checked`;
    case "call":
      return `${name} called ${e.amount}`;
    case "bet":
      return `${name} bet ${e.amount}`;
    case "raise":
      return `${name} raised to ${e.amount}`;
    case "draw":
      return e.amount ? `${name} swapped ${e.amount}` : `${name} stood pat`;
  }
}

// The word on a seat for its last move this street: "Raise 200", "Check", "All in".
export function actionLabel(e: LogEntry): string {
  if (e.allIn) return "All in";
  switch (e.kind) {
    case "blind":
      return "Blind";
    case "fold":
      return "Fold";
    case "check":
      return "Check";
    case "call":
      return "Call";
    case "bet":
      return "Bet";
    case "raise":
      return "Raise";
    case "draw":
      return e.amount ? `Swap ${e.amount}` : "Pat";
  }
}

// A hand's name as it reads mid-sentence: "with a pair of Kings", "with two pair", "with Ace high".
export function handInSentence(name: string) {
  if (name.endsWith(" high") && !name.includes(",")) return name;
  const lower = name[0].toLowerCase() + name.slice(1);
  return /^(pair|flush|straight|full|royal)/.test(lower) ? `a ${lower}` : lower;
}

// Who took the biggest share of the last hand: "Chris won 340 with two pair, Kings and 7s", or "Chris took
// 60" when everyone else folded. `you` names the reader's own seat "You".
export function resultText(r: HandResult, nameOf: (seat: number) => string): string {
  const winners = r.won.map((w, seat) => ({ w, seat })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w);
  if (!winners.length) return `Hand ${r.hand} is over`;
  const top = winners[0];
  if (!r.showdown) return `${nameOf(top.seat)} took ${top.w}`;
  const split = r.pots[0].winners.length > 1;
  const name = r.names[top.seat];
  const verb = split ? "split the pot" : `won ${top.w}`;
  const who = split ? r.pots[0].winners.map(nameOf).join(" and ") : nameOf(top.seat);
  return name ? `${who} ${verb} with ${handInSentence(name)}` : `${who} ${verb}`;
}
