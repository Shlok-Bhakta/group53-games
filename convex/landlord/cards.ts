// The two decks, sixteen cards each, with the classic US decks' effects (2008 and later) in our own words.
// A deck is drawn from the top and each card goes back underneath, never reshuffled; a get-out-of-jail card
// stays with whoever drew it until it's used, sold or they go bankrupt.

export type Deck = "chance" | "chest";

export type Effect =
  | { k: "advance"; to: number }
  // To the next station or utility ahead, where rent is doubled (a station) or ten times a fresh roll (a utility).
  | { k: "nearest"; kind: "rail" | "util" }
  | { k: "back"; n: number }
  | { k: "collect"; amount: number }
  | { k: "pay"; amount: number }
  | { k: "jail" }
  | { k: "free" }
  | { k: "repairs"; house: number; hotel: number }
  | { k: "payEach"; amount: number }
  | { k: "collectEach"; amount: number };

export type Card = { text: string; effect: Effect };

export const DECKS: Record<Deck, readonly Card[]> = {
  chance: [
    { text: "Take a stroll up to Summit Heights.", effect: { k: "advance", to: 39 } },
    { text: "Back to Start. Collect $200.", effect: { k: "advance", to: 0 } },
    { text: "Head to Crown Avenue. Collect $200 if you pass Start.", effect: { k: "advance", to: 24 } },
    { text: "Head to Rose Court. Collect $200 if you pass Start.", effect: { k: "advance", to: 11 } },
    { text: "Catch the next train: on to the nearest station. If it's owned, pay double rent; if not, you can buy it.", effect: { k: "nearest", kind: "rail" } },
    { text: "Catch the next train: on to the nearest station. If it's owned, pay double rent; if not, you can buy it.", effect: { k: "nearest", kind: "rail" } },
    { text: "On to the nearest utility. If it's owned, roll and pay ten times the roll; if not, you can buy it.", effect: { k: "nearest", kind: "util" } },
    { text: "Your shares paid out. Collect $50.", effect: { k: "collect", amount: 50 } },
    { text: "Get out of jail free. Keep this until you need it, or sell it.", effect: { k: "free" } },
    { text: "Missed your stop. Go back three squares.", effect: { k: "back", n: 3 } },
    { text: "Straight to jail. Don't pass Start, don't collect $200.", effect: { k: "jail" } },
    { text: "Upkeep on everything you've built: $25 a house, $100 a hotel.", effect: { k: "repairs", house: 25, hotel: 100 } },
    { text: "Caught speeding. Pay $15.", effect: { k: "pay", amount: 15 } },
    { text: "Take a ride out to Northgate Station. Collect $200 if you pass Start.", effect: { k: "advance", to: 5 } },
    { text: "You've been made chair of the board. Pay everyone $50.", effect: { k: "payEach", amount: 50 } },
    { text: "Your building loan matured. Collect $150.", effect: { k: "collect", amount: 150 } },
  ],
  chest: [
    { text: "Back to Start. Collect $200.", effect: { k: "advance", to: 0 } },
    { text: "The bank made a mistake in your favor. Collect $200.", effect: { k: "collect", amount: 200 } },
    { text: "A trip to the doctor. Pay $50.", effect: { k: "pay", amount: 50 } },
    { text: "You sold some shares. Collect $50.", effect: { k: "collect", amount: 50 } },
    { text: "Get out of jail free. Keep this until you need it, or sell it.", effect: { k: "free" } },
    { text: "Straight to jail. Don't pass Start, don't collect $200.", effect: { k: "jail" } },
    { text: "Your holiday fund matured. Collect $100.", effect: { k: "collect", amount: 100 } },
    { text: "A tax refund. Collect $20.", effect: { k: "collect", amount: 20 } },
    { text: "It's your birthday! Everyone gives you $10.", effect: { k: "collectEach", amount: 10 } },
    { text: "Your life insurance matured. Collect $100.", effect: { k: "collect", amount: 100 } },
    { text: "Hospital bills. Pay $100.", effect: { k: "pay", amount: 100 } },
    { text: "School fees. Pay $50.", effect: { k: "pay", amount: 50 } },
    { text: "A consulting gig. Collect $25.", effect: { k: "collect", amount: 25 } },
    { text: "The street needs fixing: $40 a house, $115 a hotel.", effect: { k: "repairs", house: 40, hotel: 115 } },
    { text: "Second place in a beauty contest. Collect $10.", effect: { k: "collect", amount: 10 } },
    { text: "A distant relative left you $100.", effect: { k: "collect", amount: 100 } },
  ],
};

export const FREE_CARD: Record<Deck, number> = {
  chance: DECKS.chance.findIndex((c) => c.effect.k === "free"),
  chest: DECKS.chest.findIndex((c) => c.effect.k === "free"),
};
