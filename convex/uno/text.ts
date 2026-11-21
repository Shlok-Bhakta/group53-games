import { COLOR_NAME, cardName, isWild } from "./cards";
import type { LogEntry, UnoState } from "./engine";

const cards = (n: number) => (n === 1 ? "1 card" : `${n} cards`);

export function entryText(e: LogEntry, nameOf: (seat: number) => string): string {
  const who = nameOf(e.seat);
  const them = e.target !== undefined ? nameOf(e.target) : "someone";
  switch (e.kind) {
    case "play":
    case "jump": {
      const card = cardName(e.card!);
      const color = e.color ? ` (${COLOR_NAME[e.color]})` : "";
      return e.kind === "jump" ? `${who} jumped in with ${card}` : `${who} played ${card}${color}`;
    }
    case "draw":
      return e.auto ? `${who} ran out of time and drew` : `${who} drew ${cards(e.n ?? 1)}`;
    case "pass":
      return `${who} kept the card`;
    case "take":
      return `${who} took ${cards(e.n ?? 0)}`;
    case "challenge":
      return e.guilty ? `${who} caught ${them} bluffing` : `${who} challenged ${them} and lost`;
    case "roulette":
      return `${who} spun for ${COLOR_NAME[e.color!]} and flipped ${cards(e.n ?? 0)}`;
    case "catch":
      return `${who} caught ${them} without UNO`;
    case "uno":
      return `${who} called UNO`;
    case "swap":
      return `${who} swapped hands with ${them}`;
    case "rotate":
      return `${who} passed every hand along`;
    case "mercy":
      return `${who} hit ${e.n} cards and is out`;
    case "leave":
      return `${who} left`;
  }
}

export function askText(s: UnoState, seat: number): string {
  const p = s.pending;
  if (p?.kind === "draw") return p.challenge ? `+${p.amount} on you. Take them or challenge.` : `+${p.amount} on you. Stack or take them.`;
  if (p?.kind === "roulette") return "Color Roulette: pick a color and flip till you hit it.";
  const on = isWild(s.top) ? `${COLOR_NAME[s.color]} is up` : `${cardName(s.top)} on top`;
  return `${on}. You have ${cards(s.counts[seat])}.`;
}
