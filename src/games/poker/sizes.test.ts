import { describe, expect, test } from "vitest";
import { deckOf } from "../../../convex/poker/cards";
import { deal, newGame, raiseBounds, type Limit } from "../../../convex/poker/engine";
import { raiseSizes } from "./sizes";

const sizes = (limit: Limit, stack = 1000) => {
  const { state } = deal(newGame("holdem", limit, 3, stack), { sb: 10, bb: 20 }, deckOf(false));
  return raiseSizes(state, 0, raiseBounds(state, 0)!);
};

describe("raise sizes", () => {
  test("no limit offers every share of the pot up to 2× and all in", () => {
    expect(sizes("nl")).toEqual([
      { label: "Min", value: 40 },
      { label: "⅓ pot", value: 40 },
      { label: "½ pot", value: 45 },
      { label: "⅔ pot", value: 53 },
      { label: "¾ pot", value: 58 },
      { label: "Pot", value: 70 },
      { label: "2× pot", value: 120 },
      { label: "All in", value: 1000 },
    ]);
  });

  test("a pot limit ends on the cap, named for it", () => {
    expect(sizes("pl").map((s) => s.label)).toEqual(["Min", "⅓ pot", "½ pot", "⅔ pot", "¾ pot", "Pot"]);
    expect(sizes("pl").at(-1)).toEqual({ label: "Pot", value: 70 });
    expect(sizes("2pl").at(-1)).toEqual({ label: "2× pot", value: 120 });
    expect(sizes("hpl")).toEqual([
      { label: "Min", value: 40 },
      { label: "⅓ pot", value: 40 },
      { label: "½ pot", value: 45 },
    ]);
  });

  test("a cap past the stack is all in", () => {
    expect(sizes("2pl", 100).at(-1)).toEqual({ label: "All in", value: 100 });
  });
});
