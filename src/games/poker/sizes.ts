import { POT_CAP, potOf, toCall, type PokerState } from "../../../convex/poker/engine";
import { sum } from "./format";

const POT_SIZES = [
  { label: "⅓ pot", of: 1 / 3 },
  { label: "½ pot", of: 1 / 2 },
  { label: "⅔ pot", of: 2 / 3 },
  { label: "¾ pot", of: 3 / 4 },
  { label: "Pot", of: 1 },
  { label: "2× pot", of: 2 },
];

export function raiseSizes(state: PokerState, seat: number, bounds: { min: number; max: number }) {
  const clamp = (v: number) => Math.max(bounds.min, Math.min(bounds.max, Math.round(v)));
  const afterCall = potOf(state) + sum(state.bets) + toCall(state, seat);
  const cap = POT_CAP[state.limit];
  const allIn = bounds.max >= state.bets[seat] + state.stacks[seat];
  return [
    { label: "Min", value: bounds.min },
    ...POT_SIZES.filter((p) => cap === null || p.of < cap).map((p) => ({ label: p.label, value: clamp(state.current + p.of * afterCall) })),
    { label: allIn ? "All in" : (POT_SIZES.find((p) => p.of === cap)?.label ?? "Max"), value: bounds.max },
  ];
}
