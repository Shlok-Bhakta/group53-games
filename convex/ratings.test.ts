import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { elo, multiElo } from "./ratings";
import { setup, signedIn } from "./test.setup";

const K = 32;
const FAVOURITE_1400_VS_1200_EXPECTS = 0.759747;
const PAIR_WEIGHT_OF_FOUR = K / 3;
const EXPECTED_SCORE = {
  "1300 v 1200": 0.640065,
  "1300 v 1250": 0.571463,
  "1300 v 1100": 0.759747,
  "1200 v 1250": 0.428537,
  "1250 v 1100": 0.703313,
  "1200 v 1100": 0.640065,
};
const by = (sum: number) => Math.round(PAIR_WEIGHT_OF_FOUR * sum);

describe("Elo with unequal ratings, against numbers worked out by hand", () => {
  test("two players: the favourite gains little for winning and loses a lot for the upset", () => {
    const favouriteWins = Math.round(K * (1 - FAVOURITE_1400_VS_1200_EXPECTS));
    const upset = Math.round(K * (0 - FAVOURITE_1400_VS_1200_EXPECTS));
    const draw = Math.round(K * (0.5 - FAVOURITE_1400_VS_1200_EXPECTS));
    expect([favouriteWins, upset, draw]).toEqual([8, -24, -8]);
    expect(multiElo([1400, 1200], [0, 1])).toEqual([favouriteWins, -favouriteWins]);
    expect(multiElo([1400, 1200], [1, 0])).toEqual([upset, -upset]);
    expect(multiElo([1200, 1400], [1, 0]), "the same game, seats the other way round").toEqual([-favouriteWins, favouriteWins]);
    expect(multiElo([1200, 1400], [0, 1]), "the same upset, seats the other way round").toEqual([-upset, upset]);
    expect(multiElo([1400, 1200], [0, 0]), "a draw takes from the favourite").toEqual([draw, -draw]);
  });

  test("two-player elo() agrees with multiElo", () => {
    expect(elo(1400, 1200, 1)).toBe(8);
    expect(elo(1400, 1200, 0)).toBe(-24);
    expect(elo(1200, 1400, 1)).toBe(24);
    expect(elo(1400, 1200, 0.5)).toBe(-8);
    expect(elo(1200, 1200, 1)).toBe(16);
  });

  test("four players with a tie in the middle", () => {
    expect(multiElo([1200, 1200, 1200, 1200], [0, 1, 1, 3]), "equal ratings: the two sharing second come out even").toEqual([
      16, 0, 0, -16,
    ]);
    const e = EXPECTED_SCORE;
    const firstAt1300 = by(1 - e["1300 v 1200"] + (1 - e["1300 v 1250"]) + (1 - e["1300 v 1100"]));
    const secondAt1200 = by(0 - (1 - e["1300 v 1200"]) + (0.5 - e["1200 v 1250"]) + (1 - e["1200 v 1100"]));
    const secondAt1250 = by(0 - (1 - e["1300 v 1250"]) + (0.5 - (1 - e["1200 v 1250"])) + (1 - e["1250 v 1100"]));
    const lastAt1100 = by(0 - (1 - e["1300 v 1100"]) + (0 - (1 - e["1200 v 1100"])) + (0 - (1 - e["1250 v 1100"])));
    expect([firstAt1300, secondAt1200, secondAt1250, lastAt1100]).toEqual([11, 1, -2, -10]);
    expect(multiElo([1300, 1200, 1250, 1100], [0, 1, 1, 2])).toEqual([11, 1, -2, -10]);
    expect(multiElo([1300, 1200, 1250, 1100], [0, 1, 1, 3]), "only the order of places matters").toEqual([11, 1, -2, -10]);
  });
});

describe("the crew's ratings", () => {
  test("every mode someone has played, highest first, without unplayed rows", async () => {
    const t = setup();
    const { as, userId: shlok } = await signedIn(t);
    const { userId: chris } = await signedIn(t, "Chris");
    const rating = (userId: typeof shlok, mode: string, value: number, games: number) =>
      t.run((ctx) => ctx.db.insert("ratings", { userId, mode, rating: value, games, wins: games, losses: 0, draws: 0 }));
    await rating(shlok, "chess:classic", 1216, 1);
    await rating(chris, "chess:classic", 1232, 2);
    await rating(chris, "uno:classic", 1200, 0);
    const rows = await as.query(api.ratings.crew, {});
    expect(rows.map((r) => [r.mode, r.userId, r.rating])).toEqual([
      ["chess:classic", chris, 1232],
      ["chess:classic", shlok, 1216],
    ]);
  });

  test("signed out sees nothing", async () => {
    const t = setup();
    expect(await t.query(api.ratings.crew, {})).toEqual([]);
  });
});
