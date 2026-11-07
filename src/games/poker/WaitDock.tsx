import { useMutation, useQuery } from "convex/react";
import { CoinsIcon, HandPalmIcon, HandTapIcon, type Icon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { MatchView } from "../../../convex/matches";
import { streetOf, toCall, type PokerState } from "../../../convex/poker/engine";
import { AsyncButton } from "@/components/AsyncButton";
import { DockNote } from "@/components/game/GameFrame";
import { ResignButton } from "@/components/match";
import { chips } from "./format";

// Not my turn: line up a move for when the action reaches me, so the game doesn't wait on me.
export function WaitDock({ match, state, seat }: { match: MatchView; state: PokerState; seat: number }) {
  const plan = useQuery(api.poker.myPlan, { id: match._id });
  const setPlan = useMutation(api.poker.plan).withOptimisticUpdate((store, { id, hand, street, kind, amount }) => {
    store.setQuery(api.poker.myPlan, { id }, kind ? { kind, amount: amount ?? 0, hand, street } : null);
  });
  const resign = (
    <ResignButton
      match={match}
      variant="card"
      size="dock"
      detail={match.players.length > 2 ? "You fold, your chips leave with you, and you place below everyone still playing." : "You fold and your opponent gets the win."}
    />
  );
  const inIt = state.dealt[seat] && !state.folded[seat];
  const canPlan = inIt && state.stacks[seat] > 0 && streetOf(state).kind === "bet" && state.turn >= 0;
  if (!canPlan) {
    const note = !inIt ? "Folded" : state.stacks[seat] === 0 ? "All in" : "Swapping";
    return (
      <div className="grid grid-cols-[2fr_1fr] gap-2.5">
        <DockNote>{note}</DockNote>
        {resign}
      </div>
    );
  }
  const owe = toCall(state, seat);
  const options = [
    { kind: "checkfold" as const, amount: 0, label: "Check/Fold", Icon: HandPalmIcon as Icon },
    owe === 0
      ? { kind: "check" as const, amount: 0, label: "Check", Icon: HandTapIcon as Icon }
      : { kind: "call" as const, amount: owe, label: owe >= state.stacks[seat] ? "Call all in" : `Call ${chips(owe)}`, Icon: CoinsIcon as Icon },
  ];
  const armed = (o: (typeof options)[number]) => !!plan && plan.hand === state.hand && plan.street === state.street && plan.kind === o.kind && (o.kind !== "call" || plan.amount === o.amount);
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {options.map((o) => {
        const on = armed(o);
        return (
          <AsyncButton
            key={o.kind}
            variant={on ? "default" : "card"}
            size="dock"
            aria-pressed={on}
            icon={<o.Icon weight={on ? "fill" : "bold"} />}
            onClick={() => setPlan({ id: match._id, hand: state.hand, street: state.street, ...(on ? {} : { kind: o.kind, amount: o.amount }) })}
          >
            {o.label}
          </AsyncButton>
        );
      })}
      {resign}
    </div>
  );
}
