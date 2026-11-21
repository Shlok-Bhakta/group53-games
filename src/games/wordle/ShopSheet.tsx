import { Fragment, useState } from "react";
import { useMutation } from "convex/react";
import { XIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { MatchView } from "../../../convex/matches";
import {
  ITEMS,
  ITEM_KEYS,
  MAX_CART,
  alive,
  buyOrder,
  cantPick,
  cartCost,
  fitCart,
  type Cart,
  type ItemKey,
  type WordleState,
} from "../../../convex/wordle/engine";
import { AsyncButton } from "@/components/AsyncButton";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { listNames, ordinal } from "@/lib/text";
import { cn } from "@/lib/utils";
import { sfx } from "@/sound";
import { Coins, ItemIcon } from "./parts";

const GROUPS: { title: string; target: boolean }[] = [
  { title: "Throw at someone", target: true },
  { title: "For you", target: false },
];

export function ShopSheet({
  open,
  onClose,
  match,
  state,
  seat,
  saved,
  left,
  lost,
}: {
  open: boolean;
  onClose: () => void;
  match: MatchView;
  state: WordleState;
  seat: number;
  saved: Cart;
  left: Record<ItemKey, number>;
  lost: ItemKey[];
}) {
  const send = useMutation(api.wordle.shop);
  const [draft, setCart] = useState<Cart>(saved);
  const [aiming, setAiming] = useState<ItemKey | null>(null);
  const me = state.players[seat];
  const cart = fitCart(
    draft.filter((x) => !ITEMS[x.item].target || alive(state).includes(x.target)),
    (k) => left[k] ?? 0,
    me.coins,
  );
  const targets = alive(state).filter((i) => i !== seat);
  const cost = cartCost(cart);
  const why = cantPick(state, seat, cart, (k) => left[k] ?? 0);
  const place = buyOrder(state).indexOf(seat) + 1;
  const inCart = (k: ItemKey) => cart.filter((x) => x.item === k).length;
  const add = (item: ItemKey, target: number) => {
    sfx("pick");
    setCart([...cart, { item, target }]);
    setAiming(null);
  };
  const remove = (i: number) => {
    sfx("recall");
    setCart(cart.filter((_, k) => k !== i));
  };
  const tap = (k: ItemKey) => {
    if (!ITEMS[k].target) return add(k, seat);
    if (targets.length === 1) return add(k, targets[0]);
    sfx("pick");
    setAiming(aiming === k ? null : k);
  };
  const buy = (c: Cart) =>
    send({ id: match._id, round: state.round, cart: c }).then(() => {
      sfx(c.length ? "chips" : "recall");
      onClose();
    });
  const lostNames = [...new Set(lost)].map((k) => ITEMS[k].name);

  const pinned = (
    <div className="flex flex-col gap-2 border-b border-border/60 px-4 pb-3" data-cart={cart.length}>
      <div className="flex items-center justify-between gap-2 text-callout" data-coins={me.coins}>
        <span className="flex items-center gap-1.5">
          <Coins n={me.coins - cost} className="text-heading" />
          {cost > 0 && <span className="text-muted-foreground">of {me.coins}</span>}
        </span>
        <span className="text-footnote text-muted-foreground">
          You shop {ordinal(place)} of {alive(state).length}
        </span>
      </div>
      {lostNames.length > 0 && !me.picked && (
        <p className="text-footnote text-destructive" data-lost={lost.join(",")}>
          {listNames(lostNames)} dropped out of your cart. Your coins are back.
        </p>
      )}
      {cart.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Your cart">
          {cart.map((x, i) => {
            const at = ITEMS[x.item].target ? match.players[x.target]?.name : null;
            return (
              <Button
                key={i}
                variant="bare"
                size="chip"
                onClick={() => remove(i)}
                aria-label={`Remove ${ITEMS[x.item].name}${at ? ` at ${at}` : ""}`}
                className="rounded-full bg-muted/70 py-1 pl-2 pr-2.5 text-footnote"
              >
                <ItemIcon
                  item={x.item}
                  size={16}
                  className={ITEMS[x.item].target ? "text-[var(--tile-hit)]" : "text-[var(--tile-green)]"}
                />
                <span className="truncate">
                  {ITEMS[x.item].name}
                  {at && <span className="text-muted-foreground"> at {at}</span>}
                </span>
                <XIcon size={12} weight="bold" className="text-muted-foreground" />
              </Button>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <AsyncButton size="lg" variant="ghost" className="flex-1" onClick={() => buy([])}>
          {me.picked && !saved.length ? "Passing" : "Pass"}
        </AsyncButton>
        <AsyncButton size="xl" className="flex-[2]" disabled={!cart.length || !!why} onClick={() => buy(cart)}>
          {!cart.length ? "Pick something" : (why ?? `Buy ${cart.length} for ${cost}`)}
        </AsyncButton>
      </div>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Shop" closable pinned={pinned} bodyClassName="pt-3">
      {GROUPS.map((g) => (
        <section key={g.title} className="flex flex-col gap-2" aria-label={g.title}>
          <h3 className="font-display text-heading">{g.title}</h3>
          {ITEM_KEYS.filter((k) => ITEMS[k].target === g.target).map((k) => {
            const def = ITEMS[k];
            const stock = left[k] ?? 0;
            const free = stock - inCart(k);
            const soldOut = stock === 0;
            const short = me.coins - cost < def.price;
            const off = free <= 0 || short || cart.length >= MAX_CART;
            const n = inCart(k);
            return (
              <Fragment key={k}>
                <Button
                  variant="bare"
                  size="option"
                  data-item={k}
                  data-left={stock}
                  aria-label={`${def.name}, ${def.price} coins, ${soldOut ? "sold out" : `${free} left`}`}
                  aria-expanded={def.target && targets.length > 1 ? aiming === k : undefined}
                  disabled={off}
                  onClick={() => tap(k)}
                  className={cn(
                    "items-center rounded-lg bg-muted/50 p-3 disabled:opacity-100",
                    aiming === k && "bg-primary/15 ring-2 ring-primary",
                    soldOut && "bg-muted/25",
                  )}
                >
                  <span
                    className={cn(
                      "relative grid size-11 shrink-0 place-items-center rounded-md",
                      soldOut
                        ? "bg-muted text-muted-foreground"
                        : def.target
                          ? "bg-[var(--tile-hit)] text-[var(--tile-hit-ink)]"
                          : "bg-[var(--tile-green)] text-[var(--tile-ink)]",
                    )}
                  >
                    <ItemIcon item={k} size={24} />
                    {n > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-primary text-caption font-semibold text-primary-foreground">
                        {n}
                      </span>
                    )}
                  </span>
                  <span className={cn("flex min-w-0 flex-1 flex-col whitespace-normal", (soldOut || off) && "opacity-55")}>
                    <span className="font-display text-body">{def.name}</span>
                    <span className="text-footnote font-normal text-muted-foreground">{def.text}</span>
                  </span>
                  <span className={cn("flex shrink-0 flex-col items-end", (soldOut || off) && "opacity-55")}>
                    <Coins n={def.price} className={cn("text-body", soldOut && "line-through")} />
                    <span className="text-caption font-normal text-muted-foreground">{soldOut ? "Sold out" : `${free} left`}</span>
                  </span>
                </Button>
                {aiming === k && !off && (
                  <div className="grid grid-cols-4 gap-2" role="group" aria-label={`Throw ${def.name} at`}>
                    {targets.map((t) => {
                      const p = match.players[t];
                      return (
                        <Button
                          key={t}
                          variant="bare"
                          size="tile"
                          data-target={t}
                          onClick={() => add(k, t)}
                          className="items-center rounded-lg bg-muted/50"
                        >
                          <PlayerAvatar player={p} size={40} seat={seatColor(p)} />
                          <span className="max-w-full truncate px-1 text-footnote">{p.name}</span>
                          <Coins n={state.players[t].coins} className="text-caption text-muted-foreground" />
                        </Button>
                      );
                    })}
                  </div>
                )}
              </Fragment>
            );
          })}
        </section>
      ))}
    </Sheet>
  );
}
