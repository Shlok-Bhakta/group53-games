import { useState } from "react";
import { ArrowFatUpIcon, CoinsIcon, HandTapIcon, XIcon } from "@phosphor-icons/react";
import { potOf, raiseBounds, toCall, type PokerState } from "../../../convex/poker/engine";
import { AmountSheet } from "@/components/AmountSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { ActionRail } from "@/components/game/GameFrame";
import { Button } from "@/components/ui/button";
import { chips, sum } from "./format";

export type Move = { kind: "fold" | "check" | "call" | "raise" | "draw"; to?: number; discard?: number[] };

const totalPot = (s: PokerState) => potOf(s) + sum(s.bets);

export function BetDock({ state, seat, move }: { state: PokerState; seat: number; move: (m: Move) => Promise<void> }) {
  const owe = toCall(state, seat);
  const stack = state.stacks[seat];
  const bounds = raiseBounds(state, seat);
  const [raising, setRaising] = useState(false);
  return (
    <ActionRail className="gap-2.5">
      {owe > 0 && (
        <AsyncButton variant="card" size="dock" icon={<XIcon weight="bold" />} onClick={() => move({ kind: "fold" })}>
          Fold
        </AsyncButton>
      )}
      <AsyncButton
        size="dock"
        icon={owe === 0 ? <HandTapIcon weight="fill" /> : <CoinsIcon weight="fill" />}
        onClick={() => move(owe > 0 ? { kind: "call" } : { kind: "check" })}
      >
        {owe === 0 ? "Check" : `${owe >= stack ? "All in" : "Call"} ${chips(Math.min(owe, stack))}`}
      </AsyncButton>
      {bounds && (
        <>
          <Button variant="card" size="dock" onClick={() => setRaising(true)}>
            <ArrowFatUpIcon weight="bold" />
            {state.current === 0 ? "Bet" : "Raise"}
          </Button>
          <RaiseSheet
            state={state}
            seat={seat}
            bounds={bounds}
            open={raising}
            onClose={() => setRaising(false)}
            onRaise={(to) => move({ kind: "raise", to })}
          />
        </>
      )}
    </ActionRail>
  );
}

function RaiseSheet({
  state,
  seat,
  bounds,
  open,
  onClose,
  onRaise,
}: {
  state: PokerState;
  seat: number;
  bounds: { min: number; max: number };
  open: boolean;
  onClose: () => void;
  onRaise: (to: number) => Promise<void>;
}) {
  const [to, setTo] = useState(bounds.min);
  const opening = open ? bounds.min : null;
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  if (opening !== openedAt) {
    setOpenedAt(opening);
    if (opening !== null) setTo(opening);
  }
  const clamp = (v: number) => Math.max(bounds.min, Math.min(bounds.max, Math.round(v)));
  const pot = totalPot(state);
  const owe = toCall(state, seat);
  const bet = state.current === 0;
  const sizes = [
    { label: "Min", value: bounds.min },
    { label: "½ pot", value: clamp(state.current + (pot + owe) / 2) },
    { label: "Pot", value: clamp(state.current + pot + owe) },
    { label: bounds.max >= state.bets[seat] + state.stacks[seat] ? "All in" : "Max", value: bounds.max },
  ];
  const step = state.bb;
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
