import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { MatchView } from "../../../convex/matches";
import { ITEMS, alive, buyOrder, cantPick, type ItemKey, type Pick, type WordleState } from "../../../convex/wordle/engine";
import { AsyncButton } from "@/components/AsyncButton";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { ordinal } from "@/lib/text";
import { cn } from "@/lib/utils";
import { sfx } from "@/sound";
import { Coins, ItemIcon } from "./parts";

export function ShopSheet({
  open,
  onClose,
  match,
  state,
  seat,
  pick,
}: {
  open: boolean;
  onClose: () => void;
  match: MatchView;
  state: WordleState;
  seat: number;
  pick: Pick;
}) {
  const send = useMutation(api.wordle.pick);
  const [item, setItem] = useState<ItemKey | null>(pick?.item ?? null);
  const [target, setTarget] = useState<number>(pick && pick.target !== seat ? pick.target : -1);
  const me = state.players[seat];
  const targets = alive(state).filter((i) => i !== seat);
  const chosenTarget = targets.length === 1 ? targets[0] : target;
  const wanted: Pick = item ? { item, target: ITEMS[item].target ? chosenTarget : seat } : null;
  const why = item ? cantPick(state, seat, wanted) : null;
  const place = buyOrder(state).indexOf(seat) + 1;
  const buy = (p: Pick) =>
    send({ id: match._id, round: state.round, item: p?.item ?? null, target: p?.target }).then(() => {
      sfx(p ? "chips" : "recall");
      onClose();
    });
  return (
    <Sheet open={open} onClose={onClose} title="Shop" closable>
      <div className="flex items-center justify-between text-callout" data-coins={me.coins}>
        <Coins n={me.coins} className="text-heading" />
        <span className="text-muted-foreground">
          Fewest coins buy first: you&rsquo;re {ordinal(place)} of {alive(state).length}
        </span>
      </div>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Items">
        {state.stock.map(({ item: k, left }) => {
          const def = ITEMS[k];
          const on = item === k;
          const short = me.coins < def.price;
          return (
            <Button
              key={k}
              variant="bare"
              size="option"
              role="radio"
              aria-checked={on}
              data-item={k}
              disabled={short}
              onClick={() => {
                sfx("pick");
                setItem(on ? null : k);
              }}
              className={cn("items-center rounded-lg bg-muted/50 p-3", on && "bg-primary/15 ring-2 ring-primary")}
            >
              <span
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-md",
                  def.target ? "bg-[var(--tile-hit)] text-[var(--tile-hit-ink)]" : "bg-[var(--tile-green)] text-[var(--tile-ink)]",
                )}
              >
                <ItemIcon item={k} size={24} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col whitespace-normal">
                <span className="font-display text-body">{def.name}</span>
                <span className="text-footnote font-normal text-muted-foreground">{def.text}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <Coins n={def.price} className="text-body" />
                <span className="text-caption font-normal text-muted-foreground">{left} left</span>
              </span>
            </Button>
          );
        })}
      </div>
      {item && ITEMS[item].target && targets.length > 1 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-heading">Throw it at</h3>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Throw it at">
            {targets.map((t) => {
              const p = match.players[t];
              return (
                <Button
                  key={t}
                  variant="bare"
                  size="tile"
                  role="radio"
                  aria-checked={chosenTarget === t}
                  data-target={t}
                  onClick={() => setTarget(t)}
                  className={cn("items-center rounded-lg", chosenTarget === t ? "bg-primary/15 ring-2 ring-primary" : "bg-muted/50")}
                >
                  <PlayerAvatar player={p} size={40} seat={seatColor(p)} />
                  <span className="max-w-full truncate px-1 text-footnote">{p.name}</span>
                  <Coins n={state.players[t].coins} className="text-caption text-muted-foreground" />
                </Button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 pt-1">
        <AsyncButton size="xl" className="w-full" disabled={!item || !!why} onClick={() => buy(wanted)}>
          {item ? (why ?? `Buy ${ITEMS[item].name} for ${ITEMS[item].price}`) : "Pick something"}
        </AsyncButton>
        <AsyncButton size="lg" variant="ghost" className="w-full" onClick={() => buy(null)}>
          {pick === null && me.picked ? "Passing" : "Pass and keep my coins"}
        </AsyncButton>
      </div>
    </Sheet>
  );
}
