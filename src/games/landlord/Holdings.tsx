import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { BOARD, GROUP_KEYS, mortgageOf, squaresIn, unmortgageOf } from "../../../convex/landlord/board";
import { cantBuild, cantMortgage, cantSell, cantUnmortgage, raisable, type MonoState } from "../../../convex/landlord/engine";
import { money } from "../../../convex/landlord/text";
import type { MatchView } from "../../../convex/matches";
import { AsyncButton } from "@/components/AsyncButton";
import { Group } from "@/components/parts";
import { Sheet } from "@/components/ui/sheet";
import { useLandlordMove } from "./Deed";

// Everything you own, by group, with building and mortgaging one tap away: how you raise money for a debt,
// and how you build up between turns.
export function HoldingsSheet({ open, onClose, match, state, seat, busy, onDeed }: { open: boolean; onClose: () => void; match: MatchView; state: MonoState; seat: number; busy: boolean; onDeed: (pos: number) => void }) {
  const act = useLandlordMove(match._id);
  const p = state.players[seat];
  const groups = GROUP_KEYS.map((key) => squaresIn(key).filter((i) => state.props[i]!.owner === seat)).filter((g) => g.length);
  const ph = state.phase;
  const owe = ph.k === "debt" && ph.from === seat ? ph.amount : 0;
  return (
    <Sheet open={open} onClose={onClose} title="Your properties" closable>
      {p && (
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="font-display text-title tabular-nums">{money(p.cash)}</div>
            <div className="text-footnote text-muted-foreground">{owe ? `You owe ${money(owe)}` : "Cash"}</div>
          </div>
          <div className="text-right">
            <div className="font-display text-heading tabular-nums">{money(raisable(state, seat))}</div>
            <div className="text-footnote text-muted-foreground">More you could raise</div>
          </div>
        </div>
      )}
      {groups.length === 0 && <p className="py-6 text-center text-callout text-muted-foreground">Nothing yet.</p>}
      {groups.map((g) => (
        <Group key={g[0]}>
          {g.map((pos) => {
            const sq = BOARD[pos];
            const prop = state.props[pos]!;
            const status = prop.mortgaged ? "Mortgaged" : prop.houses === 5 ? "Hotel" : prop.houses ? `${prop.houses} house${prop.houses > 1 ? "s" : ""}` : money(sq.kind === "street" || sq.kind === "rail" || sq.kind === "util" ? sq.price : 0);
            return (
              <div key={pos} className="flex min-h-16 items-center gap-2 px-3 py-2">
                <button type="button" className="flex min-w-0 flex-1 touch-manipulation items-center gap-3 text-left" onClick={() => onDeed(pos)}>
                  <span className="ll-swatch size-8 shrink-0 rounded-sm" data-group={sq.kind === "street" ? sq.group : undefined} style={sq.kind === "street" ? undefined : { background: "var(--muted)" }} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{sq.name}</span>
                    <span className="block truncate text-footnote text-muted-foreground">{status}</span>
                  </span>
                </button>
                {sq.kind === "street" && !prop.mortgaged && (
                  <>
                    {stuck(state, seat, pos) ? (
                      // The bank can't break the hotel into houses: the whole group's buildings go at once.
                      <AsyncButton variant="secondary" size="sm" disabled={busy} onClick={() => act({ k: "sellAll", pos })}>
                        Sell group
                      </AsyncButton>
                    ) : (
                      <AsyncButton variant="secondary" size="icon" aria-label={`Sell a building on ${sq.name}`} disabled={busy || !!cantSell(state, seat, pos)} onClick={() => act({ k: "sell", pos })}>
                        <MinusIcon weight="bold" />
                      </AsyncButton>
                    )}
                    <AsyncButton variant="secondary" size="icon" aria-label={`Build on ${sq.name}`} disabled={busy || !!cantBuild(state, seat, pos)} onClick={() => act({ k: "build", pos })}>
                      <PlusIcon weight="bold" />
                    </AsyncButton>
                  </>
                )}
                {prop.mortgaged ? (
                  <AsyncButton variant="secondary" size="sm" disabled={busy || !!cantUnmortgage(state, seat, pos)} onClick={() => act({ k: "unmortgage", pos })}>
                    Lift {money(unmortgageOf(pos))}
                  </AsyncButton>
                ) : (
                  <AsyncButton variant="secondary" size="sm" disabled={busy || !!cantMortgage(state, seat, pos)} onClick={() => act({ k: "mortgage", pos })}>
                    +{money(mortgageOf(pos))}
                  </AsyncButton>
                )}
              </div>
            );
          })}
        </Group>
      ))}
    </Sheet>
  );
}

const stuck = (s: MonoState, seat: number, pos: number) => s.props[pos]!.houses === 5 && !!cantSell(s, seat, pos)?.includes("break");
