import { useEffect, useState } from "react";
import { ArrowFatUpIcon, CoinsIcon, HandTapIcon, XIcon } from "@phosphor-icons/react";
import { potOf, raiseBounds, toCall, type PokerState } from "../../../convex/poker/engine";
import { AmountSheet } from "@/components/AmountSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { chips, sum } from "./format";

export type Move = { kind: "fold" | "check" | "call" | "raise" | "draw"; to?: number; discard?: number[] };

// The pot as everyone thinks of it: what's in the middle plus what's in front of everyone.
const totalPot = (s: PokerState) => potOf(s) + sum(s.bets);

// My move in a betting round: fold, check or call, and bet or raise.
export function BetDock({ state, seat, move }: { state: PokerState; seat: number; move: (m: Move) => Promise<void> }) {
  const owe = toCall(state, seat);
  const stack = state.stacks[seat];
  const bounds = raiseBounds(state, seat);
  const [raising, setRaising] = useState(false);
  const cols = (owe > 0 ? 1 : 0) + 1 + (bounds ? 1 : 0);
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {owe > 0 && (
        <AsyncButton variant="card" size="dock" icon={<XIcon weight="bold" />} onClick={() => move({ kind: "fold" })}>
          Fold
        </AsyncButton>
      )}
      <AsyncButton size="dock" icon={owe === 0 ? <HandTapIcon weight="fill" /> : <CoinsIcon weight="fill" />} onClick={() => move(owe > 0 ? { kind: "call" } : { kind: "check" })}>
        {owe === 0 ? "Check" : `${owe >= stack ? "All in" : "Call"} ${chips(Math.min(owe, stack))}`}
      </AsyncButton>
      {bounds && (
        <>
          <Button variant="card" size="dock" onClick={() => setRaising(true)}>
            <ArrowFatUpIcon weight="bold" />
            {state.current === 0 ? "Bet" : "Raise"}
          </Button>
          <RaiseSheet state={state} seat={seat} bounds={bounds} open={raising} onClose={() => setRaising(false)} onRaise={(to) => move({ kind: "raise", to })} />
        </>
      )}
    </div>
  );
}

// How much to bet or raise: a slider, the usual sizes, and fine steps of a big blind.
function RaiseSheet({ state, seat, bounds, open, onClose, onRaise }: { state: PokerState; seat: number; bounds: { min: number; max: number }; open: boolean; onClose: () => void; onRaise: (to: number) => Promise<void> }) {
  const [to, setTo] = useState(bounds.min);
  useEffect(() => {
    if (open) setTo(bounds.min);
  }, [open, bounds.min]);
  const clamp = (v: number) => Math.max(bounds.min, Math.min(bounds.max, Math.round(v)));
  const pot = totalPot(state);
  const owe = toCall(state, seat);
  const bet = state.current === 0;
  const sizes = [
    { label: "Min", value: bounds.min },
    { label: "½ pot", value: clamp(state.current + (pot + owe) / 2) },
    { label: "Pot", value: clamp(state.current + pot + owe) },
    // Pot limit can stop short of everything I have.
    { label: bounds.max >= state.bets[seat] + state.stacks[seat] ? "All in" : "Max", value: bounds.max },
  ];
  const step = state.bb;
  // The slider moves in big blinds, except at its ends.
  const snap = (v: number) => (v >= bounds.max ? bounds.max : v <= bounds.min ? bounds.min : clamp(Math.round(v / step) * step));
  const allIn = to >= state.bets[seat] + state.stacks[seat];
  return (
    <AmountSheet
      open={open}
      onClose={onClose}
      title={bet ? "Bet" : "Raise to"}
      value={to}
      onChange={setTo}
      min={bounds.min}
      max={bounds.max}
      snap={snap}
      step={step}
      presets={sizes}
      display={chips(to)}
      confirm={allIn ? `All in ${chips(to)}` : bet ? `Bet ${chips(to)}` : `Raise to ${chips(to)}`}
      onConfirm={async () => {
        await onRaise(to);
        onClose();
      }}
    />
  );
}
