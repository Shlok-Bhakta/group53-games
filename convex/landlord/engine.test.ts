import { describe, expect, test } from "vitest";
import { BOARD, HOUSES, JAIL } from "./board";
import { DECKS } from "./cards";
import { BANK, DEFAULT_RULES, act, actor, newGame, rentOf, standings, worth, type Action, type Game, type Rules } from "./engine";

// Dice that come up as given, in order (each die is one call).
const dice = (...ds: number[]) => {
  const q = ds.map((d) => (d - 1) / 6 + 0.01);
  return () => {
    if (!q.length) throw new Error("Ran out of scripted dice.");
    return q.shift()!;
  };
};
const game = (n = 2, rules: Partial<Rules> = {}) => newGame(n, { ...DEFAULT_RULES, ...rules }, () => 0.5);
const play = (g: Game, seat: number, a: Action, ...ds: number[]) => act(g, seat, a, dice(...ds));
const roll = (g: Game, seat: number, d1: number, d2: number, ...more: number[]) => play(g, seat, { k: "roll" }, d1, d2, ...more);
const own = (g: Game, seat: number, ...pos: number[]) => {
  for (const i of pos) g.s.props[i]!.owner = seat;
};
const cash = (g: Game) => g.s.players.map((p) => p.cash);
const card = (deck: "chance" | "chest", k: string) => DECKS[deck].findIndex((c) => JSON.stringify(c.effect).includes(k));

describe("moving round the board", () => {
  test("a roll moves you and offers what you land on", () => {
    const g = roll(game(), 0, 1, 2);
    expect(g.s.players[0].pos).toBe(3);
    expect(g.s.phase).toEqual({ k: "buy", pos: 3 });
    expect(actor(g.s)).toBe(0);
  });
  test("buying pays the price and passes the turn", () => {
    const g = play(roll(game(), 0, 1, 2), 0, { k: "buy" });
    expect(g.s.props[3]!.owner).toBe(0);
    expect(cash(g)).toEqual([1440, 1500]);
    expect(g.s.current).toBe(1);
    expect(g.s.phase.k).toBe("roll");
  });
  test("passing Start pays $200, landing on it double with the house rule", () => {
    let g = game();
    g.s.players[0].pos = 38;
    g = roll(g, 0, 1, 2);
    expect(g.s.players[0].pos).toBe(1);
    expect(g.s.players[0].cash).toBe(1700);
    expect(g.s.players[0].lapped).toBe(true);
    let h = game(2, { goDouble: true });
    h.s.players[0].pos = 35;
    h = roll(h, 0, 2, 3);
    expect(h.s.players[0].pos).toBe(0);
    expect(h.s.players[0].cash).toBe(1900);
  });
  test("doubles roll again, and a third pair sends you to jail", () => {
    // Income tax is on 4: it's paid and the roll comes back to you.
    let g = roll(game(), 0, 2, 2);
    expect(g.s.players[0].cash).toBe(1300);
    expect(g.s.current).toBe(0);
    expect(g.s.phase.k).toBe("roll");
    g = roll(g, 0, 1, 1);
    g = play(g, 0, { k: "decline" });
    // Nobody bids: the auction is everyone dropping out.
    g = play(play(g, 0, { k: "fold" }), 1, { k: "fold" });
    expect(g.s.current).toBe(0);
    g = roll(g, 0, 1, 1);
    expect(g.s.players[0].pos).toBe(JAIL);
    expect(g.s.players[0].jail).toBe(0);
    expect(g.s.current).toBe(1);
  });
  test("Go to Jail doesn't pay for passing Start and ends the turn, even on doubles", () => {
    let g = game();
    g.s.players[0].pos = 26;
    g = roll(g, 0, 2, 2);
    expect(g.s.players[0].pos).toBe(JAIL);
    expect(g.s.players[0].cash).toBe(1500);
    expect(g.s.current).toBe(1);
  });
});

describe("jail", () => {
  const jailed = () => {
    const g = game();
    g.s.players[0].pos = JAIL;
    g.s.players[0].jail = 0;
    return g;
  };
  test("doubles get you out and move you, without another roll", () => {
    const g = roll(jailed(), 0, 3, 3);
    expect(g.s.players[0].jail).toBe(-1);
    expect(g.s.players[0].pos).toBe(16);
    expect(g.s.again).toBe(false);
    const h = play(g, 0, { k: "buy" });
    expect(h.s.current).toBe(1);
  });
  test("three misses: pay $50 and move by the third roll", () => {
    let g = jailed();
    for (const [a, b] of [[6, 5], [1, 2]]) {
      g = roll(g, 0, 1, 2);
      expect(g.s.players[0].pos).toBe(JAIL);
      g = roll(g, 1, a, b);
      g = play(g, 1, { k: "decline" });
      g = play(play(g, 1, { k: "fold" }), 0, { k: "fold" });
    }
    g = roll(g, 0, 1, 2);
    expect(g.s.players[0].jail).toBe(-1);
    expect(g.s.players[0].pos).toBe(13);
    expect(g.s.players[0].cash).toBe(1450);
  });
  test("pay or use a card first, then roll as normal", () => {
    let g = play(jailed(), 0, { k: "payJail" });
    expect(g.s.players[0].cash).toBe(1450);
    expect(g.s.players[0].jail).toBe(-1);
    g = roll(g, 0, 1, 2);
    expect(g.s.players[0].pos).toBe(13);
    let h = jailed();
    h.s.players[0].free = ["chance"];
    h.decks.chance = h.decks.chance.filter((c) => c !== card("chance", "free"));
    h = play(h, 0, { k: "cardJail" });
    expect(h.s.players[0].free).toEqual([]);
    expect(h.decks.chance.at(-1)).toBe(card("chance", "free"));
  });
  test("rent is collected from jail, unless the house rule says not", () => {
    for (const jailRent of [true, false]) {
      const g = game(2, { jailRent });
      own(g, 1, 3);
      g.s.players[1].pos = JAIL;
      g.s.players[1].jail = 0;
      expect(roll(g, 0, 1, 2).s.players[0].cash).toBe(jailRent ? 1496 : 1500);
    }
  });
});

describe("rent", () => {
  test("streets double for a whole group, and houses follow the deed", () => {
    const g = game();
    own(g, 1, 1);
    expect(rentOf(g.s, 1, 7)).toBe(2);
    own(g, 1, 3);
    expect(rentOf(g.s, 1, 7)).toBe(4);
    g.s.props[1]!.houses = 3;
    expect(rentOf(g.s, 1, 7)).toBe(90);
    g.s.props[1]!.houses = 5;
    expect(rentOf(g.s, 1, 7)).toBe(250);
    g.s.props[3]!.mortgaged = true;
    expect(rentOf(g.s, 3, 7)).toBe(0);
  });
  test("stations count how many the owner has, utilities the dice", () => {
    const g = game();
    own(g, 1, 5, 15);
    expect(rentOf(g.s, 5, 7)).toBe(50);
    own(g, 1, 25, 35);
    expect(rentOf(g.s, 5, 7)).toBe(200);
    own(g, 1, 12);
    expect(rentOf(g.s, 12, 7)).toBe(28);
    own(g, 1, 28);
    expect(rentOf(g.s, 12, 7)).toBe(70);
  });
});

describe("cards", () => {
  const onFortune = (top: number) => {
    const g = game();
    g.s.players[0].pos = 4;
    g.decks.chance = [top, ...g.decks.chance.filter((c) => c !== top)];
    return g;
  };
  test("the nearest station, owned, costs double", () => {
    const g = onFortune(card("chance", '"rail"'));
    own(g, 1, 15);
    const h = roll(g, 0, 1, 2);
    expect(h.s.players[0].pos).toBe(15);
    expect(cash(h)).toEqual([1450, 1550]);
    expect(h.decks.chance.at(-1)).toBe(card("chance", '"rail"'));
  });
  test("the nearest utility, owned, is ten times a fresh roll", () => {
    const g = onFortune(card("chance", '"util"'));
    own(g, 1, 12);
    const h = roll(g, 0, 1, 2, 3, 4);
    expect(h.s.players[0].pos).toBe(12);
    expect(cash(h)).toEqual([1430, 1570]);
  });
  test("back three lands you on what's there", () => {
    const g = onFortune(card("chance", '"back"'));
    const h = roll(g, 0, 1, 2);
    expect(h.s.players[0].pos).toBe(4);
    expect(h.s.players[0].cash).toBe(1300);
  });
  test("chair of the board pays everyone, a birthday collects from everyone", () => {
    const g = onFortune(card("chance", "payEach"));
    const three = newGame(3, DEFAULT_RULES, () => 0.5);
    three.decks = g.decks;
    three.s.players[0].pos = 4;
    expect(cash(roll(three, 0, 1, 2))).toEqual([1400, 1550, 1550]);
    const b = newGame(3, DEFAULT_RULES, () => 0.5);
    b.s.players[0].pos = 0;
    b.decks.chest = [card("chest", "collectEach"), ...b.decks.chest.filter((c) => c !== card("chest", "collectEach"))];
    expect(cash(roll(b, 0, 1, 1)).slice(0, 3)).toEqual([1520, 1490, 1490]);
  });
  test("repairs charge for every house and hotel", () => {
    const g = onFortune(card("chance", "repairs"));
    own(g, 0, 1, 3);
    g.s.props[1]!.houses = 5;
    g.s.props[3]!.houses = 4;
    expect(roll(g, 0, 1, 2).s.players[0].cash).toBe(1500 - 100 - 4 * 25);
  });
  test("a get-out-of-jail card stays with you and leaves the deck", () => {
    const g = onFortune(card("chance", "free"));
    const h = roll(g, 0, 1, 2);
    expect(h.s.players[0].free).toEqual(["chance"]);
    expect(h.decks.chance).not.toContain(card("chance", "free"));
  });
});

describe("auctions", () => {
  test("turning a property down auctions it, highest bid wins", () => {
    let g = game(3);
    g = play(roll(g, 0, 1, 2), 0, { k: "decline" });
    expect(g.s.phase).toMatchObject({ k: "auction", pos: 3, in: [0, 1, 2] });
    g = play(g, 1, { k: "bid", amount: 10 });
    expect(actor(g.s)).toBe(2);
    g = play(g, 2, { k: "bid", amount: 25 });
    expect(() => play(g, 0, { k: "bid", amount: 25 })).toThrow("more than $25");
    g = play(g, 0, { k: "fold" });
    g = play(g, 1, { k: "fold" });
    expect(g.s.props[3]!.owner).toBe(2);
    expect(cash(g)).toEqual([1500, 1500, 1475]);
    expect(g.s.current).toBe(1);
  });
  test("with auctions off it stays with the bank", () => {
    const g = play(roll(game(2, { auctions: false }), 0, 1, 2), 0, { k: "decline" });
    expect(g.s.props[3]!.owner).toBe(-1);
    expect(g.s.current).toBe(1);
  });
  test("a winning bid can't be spent while the auction runs", () => {
    let g = game(2);
    own(g, 1, 1, 3);
    g.s.players[1].cash = 100;
    g = play(roll(g, 0, 2, 3), 0, { k: "decline" });
    g = play(g, 1, { k: "bid", amount: 60 });
    expect(() => play(g, 1, { k: "build", pos: 1 })).toThrow("costs $50");
  });
});

describe("building", () => {
  const set = () => {
    const g = game();
    own(g, 0, 1, 3);
    return g;
  };
  test("needs the whole group and goes evenly", () => {
    const g = game();
    own(g, 0, 1);
    expect(() => play(g, 0, { k: "build", pos: 1 })).toThrow("whole color group");
    let h = play(set(), 0, { k: "build", pos: 1 });
    expect(h.s.props[1]!.houses).toBe(1);
    expect(h.s.bank.houses).toBe(HOUSES - 1);
    expect(() => play(h, 0, { k: "build", pos: 1 })).toThrow("evenly");
    h = play(h, 0, { k: "build", pos: 3 });
    expect(() => play(h, 0, { k: "sell", pos: 1 })).not.toThrow();
    expect(h.s.players[0].cash).toBe(1400);
  });
  test("can be built out of turn", () => {
    const g = set();
    g.s.current = 1;
    expect(play(g, 0, { k: "build", pos: 3 }).s.props[3]!.houses).toBe(1);
  });
  test("a hotel takes four houses and gives them back to the bank", () => {
    let g = set();
    for (let i = 0; i < 4; i++) g = play(play(g, 0, { k: "build", pos: 1 }), 0, { k: "build", pos: 3 });
    expect(g.s.bank.houses).toBe(HOUSES - 8);
    g = play(g, 0, { k: "build", pos: 1 });
    expect(g.s.props[1]!.houses).toBe(5);
    expect(g.s.bank).toEqual({ houses: HOUSES - 4, hotels: 11 });
    g = play(g, 0, { k: "sell", pos: 1 });
    expect(g.s.props[1]!.houses).toBe(4);
    expect(g.s.players[0].cash).toBe(1500 - 9 * 50 + 25);
  });
  test("the bank runs out of houses", () => {
    const g = set();
    g.s.bank.houses = 0;
    expect(() => play(g, 0, { k: "build", pos: 1 })).toThrow("out of houses");
    const h = game(2, { limited: false });
    own(h, 0, 1, 3);
    h.s.bank.houses = 0;
    expect(play(h, 0, { k: "build", pos: 1 }).s.props[1]!.houses).toBe(1);
  });
  test("a hotel can't break down without the houses; selling the group can", () => {
    let g = set();
    g.s.props[1]!.houses = 5;
    g.s.props[3]!.houses = 5;
    g.s.bank = { houses: 2, hotels: 10 };
    expect(() => play(g, 0, { k: "sell", pos: 1 })).toThrow("break the hotel down");
    g = play(g, 0, { k: "sellAll", pos: 1 });
    expect([g.s.props[1]!.houses, g.s.props[3]!.houses]).toEqual([0, 0]);
    expect(g.s.bank).toEqual({ houses: 2, hotels: 12 });
    expect(g.s.players[0].cash).toBe(1500 + 250);
  });
  test("the short game's hotels come after three houses", () => {
    const g = game(2, { short: true });
    for (const i of [1, 3]) g.s.props[i] = { owner: 0, houses: 3, mortgaged: false };
    expect(play(g, 0, { k: "build", pos: 1 }).s.props[1]!.houses).toBe(5);
  });
});

describe("mortgages", () => {
  test("half the price, and 10% more (rounded up) to lift", () => {
    const g = game();
    own(g, 0, 12);
    let h = play(g, 0, { k: "mortgage", pos: 12 });
    expect(h.s.players[0].cash).toBe(1575);
    h = play(h, 0, { k: "unmortgage", pos: 12 });
    expect(h.s.players[0].cash).toBe(1575 - 83);
  });
  test("not while the group has buildings, and no building on a mortgaged group", () => {
    const g = game();
    own(g, 0, 1, 3);
    g.s.props[3]!.houses = 1;
    expect(() => play(g, 0, { k: "mortgage", pos: 1 })).toThrow("Sell the buildings");
    g.s.props[3]!.houses = 0;
    g.s.props[3]!.mortgaged = true;
    expect(() => play(g, 0, { k: "build", pos: 1 })).toThrow("Lift the mortgages");
  });
});

describe("debts and bankruptcy", () => {
  const broke = (n = 3) => {
    const g = game(n);
    own(g, 1, 37, 39);
    g.s.props[39]!.houses = 5;
    g.s.props[37]!.houses = 4;
    own(g, 0, 1, 12);
    g.s.players[0].cash = 100;
    g.s.players[0].pos = 33;
    return g;
  };
  test("rent you can't cover waits while you raise it, and pays the moment you have", () => {
    let g = game(2);
    own(g, 1, 3);
    own(g, 0, 12);
    g.s.players[0].cash = 2;
    g = roll(g, 0, 1, 2);
    expect(g.s.phase).toMatchObject({ k: "debt", from: 0, to: 1, amount: 4 });
    expect(() => play(g, 0, { k: "pay" })).toThrow("$2 more");
    g = play(g, 0, { k: "mortgage", pos: 12 });
    expect(cash(g)).toEqual([2 + 75 - 4, 1504]);
    expect(g.s.current).toBe(1);
  });
  test("you can't go bankrupt while selling and mortgaging would cover it", () => {
    let g = game(2);
    own(g, 1, 3);
    own(g, 0, 39);
    g.s.players[0].cash = 2;
    g = roll(g, 0, 1, 2);
    expect(() => play(g, 0, { k: "bankrupt" })).toThrow("still raise");
  });
  test("going bankrupt to a player hands them everything, and 10% on the mortgages", () => {
    let g = broke();
    g.s.props[1]!.mortgaged = true;
    g = roll(g, 0, 3, 3);
    expect(g.s.phase).toMatchObject({ k: "debt", from: 0, to: 1, amount: 2000 });
    g = play(g, 0, { k: "bankrupt" });
    expect(g.s.players[0].out).toBe(true);
    expect(g.s.props[1]!.owner).toBe(1);
    expect(g.s.props[12]!.owner).toBe(1);
    // 100 cash, the utility isn't mortgaged; 10% of Cinder Lane's $30 is $3.
    expect(g.s.players[1].cash).toBe(1500 + 100 - 3);
    expect(g.s.current).toBe(1);
    expect(standings(g.s).at(-1)).toEqual([0]);
  });
  test("going bankrupt to the bank auctions everything off clear", () => {
    let g = game(3);
    own(g, 0, 1);
    g.s.props[1]!.mortgaged = true;
    g.s.players[0].cash = 10;
    g.s.players[0].pos = 36;
    g = roll(g, 0, 1, 1);
    expect(g.s.phase).toMatchObject({ k: "debt", from: 0, to: BANK, amount: 100 });
    g = play(g, 0, { k: "bankrupt" });
    expect(g.s.phase).toMatchObject({ k: "auction", pos: 1 });
    expect(g.s.props[1]).toEqual({ owner: -1, houses: 0, mortgaged: false });
  });
  test("the last one left wins", () => {
    const g = play(roll(broke(2), 0, 3, 3), 0, { k: "bankrupt" });
    expect(g.s.phase.k).toBe("over");
    expect(standings(g.s)).toEqual([[1], [0]]);
  });
  test("resigning out of turn goes bankrupt to the bank, and the game goes on", () => {
    let g = game(3);
    own(g, 2, 5);
    g = play(g, 2, { k: "resign" });
    expect(g.s.players[2].out).toBe(true);
    expect(g.s.props[5]!.owner).toBe(-1);
    expect(g.s.phase).toMatchObject({ k: "auction", pos: 5, in: [0, 1] });
    g = play(play(g, 0, { k: "fold" }), 1, { k: "fold" });
    expect(g.s.phase.k).toBe("roll");
    expect(g.s.current).toBe(0);
  });
  test("the short game ends at the second bankruptcy, richest first", () => {
    let g = newGame(4, { ...DEFAULT_RULES, short: true }, () => 0.5);
    expect(g.s.props.filter((p) => p && p.owner >= 0)).toHaveLength(8);
    g = play(g, 3, { k: "resign" });
    while (g.s.phase.k === "auction") g = play(g, g.s.phase.in[0], { k: "fold" });
    expect(g.s.phase.k).not.toBe("over");
    g = play(g, 2, { k: "resign" });
    expect(g.s.phase.k).toBe("over");
    expect(standings(g.s).slice(-2)).toEqual([[2], [3]]);
  });
});

describe("trades", () => {
  test("properties, cash and cards change hands when accepted", () => {
    let g = game();
    own(g, 0, 1);
    own(g, 1, 3);
    g.s.players[1].free = ["chest"];
    g = play(g, 0, { k: "offer", to: 1, give: { cash: 100, props: [1], free: [] }, get: { cash: 0, props: [3], free: ["chest"] } });
    expect(g.s.trades).toHaveLength(1);
    g = play(g, 1, { k: "accept", id: g.s.trades[0].id });
    expect(g.s.props[1]!.owner).toBe(1);
    expect(g.s.props[3]!.owner).toBe(0);
    expect(g.s.players[0].free).toEqual(["chest"]);
    expect(cash(g)).toEqual([1400, 1600]);
  });
  test("a mortgaged property costs its new owner 10%", () => {
    let g = game();
    own(g, 0, 39);
    g.s.props[39]!.mortgaged = true;
    g = play(g, 0, { k: "offer", to: 1, give: { cash: 0, props: [39], free: [] }, get: { cash: 300, props: [], free: [] } });
    g = play(g, 1, { k: "accept", id: 1 });
    expect(cash(g)).toEqual([1800, 1500 - 300 - 20]);
  });
  test("a mortgaged property can be lifted as it's handed over, for just the one 10%", () => {
    let g = game();
    own(g, 0, 39);
    g.s.props[39]!.mortgaged = true;
    g = play(g, 0, { k: "offer", to: 1, give: { cash: 0, props: [39], free: [] }, get: { cash: 300, props: [], free: [] } });
    g = play(g, 1, { k: "accept", id: 1, lift: [39] });
    expect(cash(g)).toEqual([1800, 1500 - 300 - 220]);
    expect(g.s.props[39]).toMatchObject({ owner: 1, mortgaged: false });
  });
  test("not with buildings in the group, and offers go when what's in them changes hands", () => {
    let g = game(3);
    own(g, 0, 1, 3);
    g.s.props[3]!.houses = 1;
    expect(() => play(g, 0, { k: "offer", to: 1, give: { cash: 0, props: [1], free: [] }, get: { cash: 10, props: [], free: [] } })).toThrow("Sell the buildings");
    g.s.props[3]!.houses = 0;
    g = play(g, 0, { k: "offer", to: 1, give: { cash: 0, props: [1], free: [] }, get: { cash: 10, props: [], free: [] } });
    g = play(g, 0, { k: "offer", to: 2, give: { cash: 0, props: [1], free: [] }, get: { cash: 20, props: [], free: [] } });
    g = play(g, 2, { k: "accept", id: 2 });
    expect(g.s.trades).toEqual([]);
    expect(g.events.some((e) => e.t === "untrade" && e.why === "stale")).toBe(true);
  });
});

describe("the speed die", () => {
  const lapped = (rules: Partial<Rules> = {}) => {
    const g = game(2, { speed: true, ...rules });
    g.s.players[0].lapped = true;
    return g;
  };
  test("isn't rolled until you've been past Start", () => {
    const g = roll(game(2, { speed: true }), 0, 1, 2);
    expect(g.s.dice).toEqual([1, 2]);
  });
  test("a number adds to the move", () => {
    const g = roll(lapped(), 0, 1, 2, 3);
    expect(g.s.players[0].pos).toBe(6);
  });
  test("Mr. Monopoly goes on to the next property nobody owns", () => {
    let g = lapped();
    own(g, 1, 5, 6, 8);
    g = roll(g, 0, 1, 2, 4);
    expect(g.s.phase).toEqual({ k: "buy", pos: 3 });
    g = play(g, 0, { k: "buy" });
    expect(g.s.players[0].pos).toBe(9);
    expect(g.s.phase).toEqual({ k: "buy", pos: 9 });
  });
  test("with everything owned, Mr. Monopoly finds the next rent you owe", () => {
    let g = lapped();
    for (const i of g.s.props.keys()) if (g.s.props[i]) g.s.props[i]!.owner = i === 5 ? 0 : 1;
    g.s.props[6]!.mortgaged = true;
    g = roll(g, 0, 1, 2, 5);
    // Rent on Tanner Row, then past the station (mine) and Harbor Walk (mortgaged) to Pier Street.
    expect(g.events.filter((e) => e.t === "move").at(-1)).toMatchObject({ to: 8 });
  });
  test("the bus moves by either die or both", () => {
    let g = roll(lapped(), 0, 1, 5, 6);
    expect(g.s.phase).toEqual({ k: "bus", dice: [1, 5] });
    g = play(g, 0, { k: "bus", choice: 0 });
    expect(g.s.players[0].pos).toBe(1);
  });
  test("comes with an extra $1,000 each", () => {
    expect(game(2, { speed: true }).s.players.map((p) => p.cash)).toEqual([2500, 2500]);
  });
  test("sent to jail on the way, the boss doesn't move you on", () => {
    let g = lapped();
    g.s.players[0].pos = 27;
    g = roll(g, 0, 1, 2, 4);
    expect(g.s.players[0]).toMatchObject({ pos: JAIL, jail: 0 });
    expect(g.s.current).toBe(1);
  });
  test("a utility reached by bus counts both white dice", () => {
    let g = lapped();
    own(g, 1, 12);
    g.s.players[0].pos = 11;
    g = play(roll(g, 0, 1, 5, 6), 0, { k: "bus", choice: 0 });
    expect(g.s.players[0].pos).toBe(12);
    expect(cash(g)).toEqual([2500 - 24, 2500 + 24]);
  });
  test("triples go anywhere and end the turn", () => {
    let g = roll(lapped(), 0, 2, 2, 2);
    expect(g.s.phase.k).toBe("pick");
    g = play(g, 0, { k: "pick", pos: 39 });
    expect(g.s.phase).toEqual({ k: "buy", pos: 39 });
    g = play(g, 0, { k: "buy" });
    expect(g.s.current).toBe(1);
  });
});

describe("house rules", () => {
  test("the jackpot takes taxes and fines and pays out on the Rest Stop", () => {
    let g = roll(game(2, { pot: 1 }), 0, 2, 2);
    expect(g.s.pot).toBe(200);
    g.s.players[0].pos = 15;
    g = roll(g, 0, 2, 3);
    expect(g.s.pot).toBe(0);
    expect(g.s.players[0].cash).toBe(1500);
    const h = game(2, { pot: 2 });
    expect(h.s.pot).toBe(500);
    h.s.players[0].pos = 15;
    const k = roll(h, 0, 2, 3);
    expect(k.s.players[0].cash).toBe(2000);
    expect(k.s.pot).toBe(500);
  });
  test("no buying on the first lap", () => {
    const g = roll(game(2, { firstLap: true }), 0, 1, 2);
    expect(g.s.props[3]!.owner).toBe(-1);
    expect(g.s.current).toBe(1);
  });
  test("a round limit ends it, richest first", () => {
    let g = game(2, { rounds: 1 });
    own(g, 1, 39);
    g = play(roll(g, 0, 1, 2), 0, { k: "decline" });
    g = play(play(g, 0, { k: "fold" }), 1, { k: "fold" });
    g = play(roll(g, 1, 1, 2), 1, { k: "buy" });
    expect(g.s.phase.k).toBe("over");
    expect(worth(g.s, 1)).toBe(1500 + 400);
    expect(standings(g.s)).toEqual([[1], [0]]);
  });
});

test("the board has its forty squares", () => {
  expect(BOARD).toHaveLength(40);
  expect(BOARD.filter((s) => s.kind === "street")).toHaveLength(22);
});
