import { describe, expect, test } from "vitest";
import { elo, multiElo } from "./ratings";

// Expected numbers worked out by hand from the formula (K = 32, expected = 1 / (1 + 10^((b - a) / 400))), so a
// sign flipped in the exponent or a swapped pair shows up even where equal ratings would hide it.
// 1400 vs 1200: the favourite is expected to score 0.759747, the underdog 0.240253.
describe("Elo with unequal ratings", () => {
  test("two players: the favourite gains little for winning and loses a lot for the upset", () => {
    // 32 * (1 - 0.759747) = 7.688
    expect(multiElo([1400, 1200], [0, 1])).toEqual([8, -8]);
    // 32 * (0 - 0.759747) = -24.312
    expect(multiElo([1400, 1200], [1, 0])).toEqual([-24, 24]);
    // The same game with the seats the other way round.
    expect(multiElo([1200, 1400], [1, 0])).toEqual([-8, 8]);
    expect(multiElo([1200, 1400], [0, 1])).toEqual([24, -24]);
    // A draw takes from the favourite: 32 * (0.5 - 0.759747) = -8.312.
    expect(multiElo([1400, 1200], [0, 0])).toEqual([-8, 8]);
  });

  test("two-player elo() agrees with multiElo", () => {
    expect(elo(1400, 1200, 1)).toBe(8);
    expect(elo(1400, 1200, 0)).toBe(-24);
    expect(elo(1200, 1400, 1)).toBe(24);
    expect(elo(1400, 1200, 0.5)).toBe(-8);
    expect(elo(1200, 1200, 1)).toBe(16);
  });

  test("four players with a tie in the middle", () => {
    // Equal ratings: the two sharing second draw each other and beat one player, lose to another: zero.
    expect(multiElo([1200, 1200, 1200, 1200], [0, 1, 1, 3])).toEqual([16, 0, 0, -16]);
    // Unequal ratings, seats 1 and 2 tied for second. Each pair weighted 32/3:
    //   1300: (1 - 0.640065) + (1 - 0.571463) + (1 - 0.759747) = 1.028725 -> 10.973
    //   1200: (0 - 0.359935) + (0.5 - 0.428537) + (1 - 0.640065) = 0.071463 -> 0.762
    //   1250: (0 - 0.428537) + (0.5 - 0.571463) + (1 - 0.703313) = -0.203385 -> -2.169
    //   1100: (0 - 0.240253) + (0 - 0.359935) + (0 - 0.296687) = -0.896803 -> -9.566
    expect(multiElo([1300, 1200, 1250, 1100], [0, 1, 1, 2])).toEqual([11, 1, -2, -10]);
    // Places only matter in order, so a gap in the numbering changes nothing.
    expect(multiElo([1300, 1200, 1250, 1100], [0, 1, 1, 3])).toEqual([11, 1, -2, -10]);
  });
});
