import { settingsOf, type ModeKey, type Settings } from "../../../convex/modes";

export function hexhavenRules(mode: ModeKey, raw: Settings): string[] {
  const s = settingsOf(mode, raw);
  return [
    "Everyone places two settlements, each with a road: round the table, then back the other way. Your second settlement hands you one of everything around it.",
    "Each turn, roll. Every hex with that number pays its resources to the settlements on its corners: one each, two for a city. The robber's hex pays nothing.",
    `Roll a 7 and anyone holding more than ${s.limit} cards gives back half. Then move the robber and steal a card from someone next to it${s.friendly ? ", but never from anyone on 2 points or fewer" : ""}.`,
    "Spend what you've got: a road is lumber and brick; a settlement is lumber, brick, wool and grain; a city (in place of a settlement) is 2 grain and 3 ore; a development card is wool, grain and ore.",
    "Settlements need a corner two steps from any other, joined to your roads. You have 15 roads, 5 settlements and 4 cities.",
    "Trade with whoever's turn it is, or with the bank: 4 of one kind for any 1, or 3:1 and 2:1 from a port you've settled. Hands are open, so everyone can see what you hold.",
    "Development cards include Knight (move the robber), Road Building (two free roads), Year of Plenty (take two resources from the bank), Monopoly (take everyone's cards of one resource) and Victory Point cards, worth a point and kept secret. One a turn, and not the turn you bought it.",
    `Settlements are a point, cities two, and the Longest Road (5 or more) and the Largest Army (3 knights or more) two each. First to ${s.points} on their own turn wins.`,
    `${s.balanced ? "6s and 8s never sit side by side" : "The numbers land anywhere, 6s and 8s side by side included"}. Five or six of you play on a bigger island.`,
    "Tap a hex or a harbor, or touch and hold anything on the board, a card in your hand or a build button, to see what it pays, costs and is worth. Building costs are in the menu too.",
    "No time limit: take your turn whenever, and we'll ping you every few hours until you do.",
  ];
}
