import { settingsOf, type ModeKey, type Settings } from "../../../convex/modes";

export function hexhavenRules(mode: ModeKey, raw: Settings): string[] {
  const s = settingsOf(mode, raw);
  return [
    "Everyone places two villages, each with a road: round the table, then back the other way. Your second village hands you one of everything around it.",
    "Each turn, roll. Every hex with that number pays its resources to the villages on its corners: one each, two for a town. The bandit's hex pays nothing.",
    `Roll a 7 and anyone holding more than ${s.limit} cards gives back half. Then move the bandit and steal a card from someone next to it${s.friendly ? ", but never from anyone on 2 points or fewer" : ""}.`,
    "Spend what you've got: a road is timber and brick; a village is timber, brick, wool and grain; a town (in place of a village) is 2 grain and 3 ore; a card is wool, grain and ore.",
    "Villages need a corner two steps from any other, joined to your roads. You have 15 roads, 5 villages and 4 towns.",
    "Trade with whoever's turn it is, or with the bank: 4 of one kind for any 1, or 3:1 and 2:1 from a harbor you've settled. Hands are open, so everyone can see what you hold.",
    "Cards: knights move the bandit, Two roads, Windfall (any two from the bank), Corner the market (everyone's of one kind) and Monuments, worth a point and kept secret. One a turn, and not the turn you bought it.",
    `Villages are a point, towns two, and the longest road (5 or more) and the biggest army (3 knights or more) two each. First to ${s.points} on their own turn wins.`,
    `${s.balanced ? "6s and 8s never sit side by side" : "The numbers land anywhere, 6s and 8s side by side included"}. Five or six of you play on a bigger island.`,
    "No time limit: take your turn whenever, and we'll ping you every few hours until you do.",
  ];
}
