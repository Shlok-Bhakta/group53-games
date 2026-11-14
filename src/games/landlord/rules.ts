import { settingsOf, type ModeKey, type Settings } from "../../../convex/modes";

// How to play, as the settings have it.
export function landlordRules(mode: ModeKey, raw: Settings): string[] {
  const s = settingsOf(mode, raw);
  const money = (n: number) => `$${n.toLocaleString("en-US")}`;
  return [
    `Everyone starts with ${money(s.cash + (s.speed ? 1000 : 0))}${s.speed ? " (an extra $1,000 for the speed die)" : ""}. Roll and go round the board; pass Start and collect $200${s.goDouble ? ", or $400 for landing right on it" : ""}.`,
    `Land on something nobody owns and you can buy it${s.auctions ? ". Turn it down and it's auctioned: everyone can bid, and the last bid standing wins" : ". Turn it down and it stays with the bank"}${s.firstLap ? ". Nobody can buy until they've been round once" : ""}.`,
    "Land on someone else's and you pay them rent. Own a whole color group and rent doubles; then build houses evenly across it, and a hotel after four. Stations pay more the more you own; utilities charge a multiple of the roll.",
    `Doubles roll again; three in a row is jail. Get out with doubles, $50 or a card, and after three tries you pay and go.${s.jailRent ? "" : " Nobody collects rent while they're in jail."}`,
    ...(s.speed ? ["From your second lap you roll the speed die too: a number adds on, the bus lets you move by either die or both, the boss sends you on to the next property nobody owns (or with none left, the next rent you owe), and triples go anywhere. Sent to jail, and the speed die does nothing that turn."] : []),
    ...(s.pot ? [`Taxes and fines go in a jackpot on the Rest Stop${s.pot === 2 ? ", which starts with $500 and is topped up to $500 every time it's taken" : ""}. Land there and it's yours.`] : []),
    "Build, sell, mortgage and trade any time, even on someone else's turn. Mortgaging pays half the price; lifting it costs that plus 10%. Get a mortgaged one in a trade and you pay 10% then, or lift it there and then for just the one 10%.",
    "Owe more than you have and you raise it by selling buildings, mortgaging or trading; only when that can't cover it are you bankrupt and out.",
    s.game === 1
      ? "Short game: everyone starts with two properties, hotels go up after three houses, and it ends at the second bankruptcy. The richest wins."
      : s.rounds
        ? `After ${s.rounds} rounds the richest wins, counting property and buildings at what they cost.`
        : "The last one left wins.",
    "No time limit: take your turn whenever, and we'll ping you every few hours until you do.",
  ];
}
