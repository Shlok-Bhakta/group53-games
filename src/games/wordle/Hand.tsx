import { useState } from "react";
import { useMutation } from "convex/react";
import { LightningIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { MatchView } from "../../../convex/matches";
import { ITEMS, ITEM_KEYS, MAX_HAND, cantPlay, rushPrice, type ItemKey, type Mine, type WordleState } from "../../../convex/wordle/engine";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { sfx } from "@/sound";
import { Coins, ItemIcon } from "./parts";

export const HAND_HEIGHT = "h-11";
const RUSHABLE = ITEM_KEYS.filter((k) => ITEMS[k].rush);

export function Hand({
  match,
  state,
  seat,
  hand,
  clues,
  playing,
}: {
  match: MatchView;
  state: WordleState;
  seat: number;
  hand: ItemKey[];
  clues: string;
  playing: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5", HAND_HEIGHT)} aria-label="Your hand" data-hand={hand.join(",")}>
      {hand.map((k, i) => (
        <Button
          key={i}
          variant="bare"
          size="chip"
          onClick={() => setOpen(true)}
          aria-label={`${ITEMS[k].name} card`}
          className="rounded-full bg-[var(--tile-green)]/15 py-1 pl-2 pr-3 text-footnote font-semibold"
        >
          <ItemIcon item={k} size={16} className="text-[var(--tile-green)]" />
          {ITEMS[k].name}
        </Button>
      ))}
      {clues && (
        <span className="ml-auto flex items-center gap-1 text-footnote text-muted-foreground" data-clues={clues}>
          In it:
          {[...clues].map((ch) => (
            <span
              key={ch}
              className="grid size-6 place-items-center rounded-xs bg-[var(--tile-yellow)] font-display text-[var(--tile-yellow-ink)] uppercase"
            >
              {ch}
            </span>
          ))}
        </span>
      )}
      {playing && state.rules.shop && (
        <Button
          variant="ghost"
          size="sm"
          className={cn("gap-1 text-muted-foreground", !clues && "ml-auto")}
          onClick={() => setOpen(true)}
          icon={<LightningIcon weight="fill" className="text-[var(--tile-yellow)]" />}
        >
          Cards
        </Button>
      )}
      <CardSheet open={open} onClose={() => setOpen(false)} match={match} state={state} seat={seat} hand={hand} clues={clues} />
    </div>
  );
}

function CardSheet({
  open,
  onClose,
  match,
  state,
  seat,
  hand,
  clues,
}: {
  open: boolean;
  onClose: () => void;
  match: MatchView;
  state: WordleState;
  seat: number;
  hand: ItemKey[];
  clues: string;
}) {
  const send = useMutation(api.wordle.play);
  const me = state.players[seat];
  const mine = { round: state.round, guesses: [], marks: [], pick: null, hand, clues } satisfies Mine;
  const held = [...new Set(hand)];
  const run = (item: ItemKey, rush: boolean) =>
    send({ id: match._id, round: state.round, item, rush }).then(() => {
      sfx(rush ? "chips" : "play");
      onClose();
    });
  return (
    <Sheet open={open} onClose={onClose} title="Cards" closable>
      <section className="flex flex-col gap-2" aria-label="Your cards">
        <h3 className="font-display text-heading">
          Your hand <span className="text-muted-foreground">{`${hand.length}/${MAX_HAND}`}</span>
        </h3>
        {held.map((k) => {
          const why = cantPlay(state, mine, seat, k, false);
          const n = hand.filter((x) => x === k).length;
          return (
            <CardRow key={k} item={k} count={n}>
              {ITEMS[k].play ? (
                <AsyncButton size="lg" disabled={!!why} onClick={() => run(k, false)} aria-label={`Play ${ITEMS[k].name}`}>
                  Play
                </AsyncButton>
              ) : (
                <span className="text-footnote text-muted-foreground">Ready</span>
              )}
            </CardRow>
          );
        })}
      </section>
      {state.rules.shop && (
        <section className="flex flex-col gap-2" aria-label="Buy and play now">
          <h3 className="flex items-center justify-between font-display text-heading">
            Buy and play now
            <Coins n={me.coins} className="text-callout" />
          </h3>
          {RUSHABLE.map((k) => {
            const why = cantPlay(state, mine, seat, k, true);
            return (
              <CardRow key={k} item={k}>
                <AsyncButton
                  size="lg"
                  variant="secondary"
                  disabled={!!why}
                  onClick={() => run(k, true)}
                  aria-label={`Buy ${ITEMS[k].name} now for ${rushPrice(k)}`}
                >
                  <Coins n={rushPrice(k)} />
                </AsyncButton>
              </CardRow>
            );
          })}
        </section>
      )}
    </Sheet>
  );
}

function CardRow({ item, count = 0, children }: { item: ItemKey; count?: number; children: React.ReactNode }) {
  const def = ITEMS[item];
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-lg bg-muted/50 p-3" data-card={item}>
      <span className="relative grid size-11 shrink-0 place-items-center rounded-md bg-[var(--tile-green)] text-[var(--tile-ink)]">
        <ItemIcon item={item} size={24} />
        {count > 1 && (
          <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-primary text-caption font-semibold text-primary-foreground">
            {count}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display text-body">{def.name}</span>
        <span className="text-footnote text-muted-foreground">{def.text}</span>
      </span>
      {children}
    </div>
  );
}
