import { useState } from "react";
import { cantDev, type Held, type HexState } from "../../../convex/hexhaven/engine";
import { CARD_NAMES, CARD_TEXT, resName } from "../../../convex/hexhaven/text";
import { AsyncButton } from "@/components/AsyncButton";
import { Sheet } from "@/components/ui/sheet";
import { ResPicker, useHexMove } from "./parts";
import type { MatchView } from "../../../convex/matches";

const ORDER = ["knight", "roads", "plenty", "corner", "point"] as const;

export const cantPlay = (state: HexState, seat: number, held: Held[], card: Held["c"]) =>
  card === "point"
    ? null
    : cantDev({ s: state, deck: [], held: state.players.map((_, i) => (i === seat ? held : [])), events: [] }, seat, card);

export function CardsSheet({
  open,
  onClose,
  match,
  state,
  seat,
  held,
}: {
  open: boolean;
  onClose: () => void;
  match: MatchView;
  state: HexState;
  seat: number;
  held: Held[];
}) {
  const act = useHexMove(match._id, state.seq);
  const [a, setA] = useState(0);
  const [b, setB] = useState(1);
  const [r, setR] = useState(4);
  const kinds = ORDER.filter((c) => held.some((h) => h.c === c));
  const play = (c: (typeof ORDER)[number]) => {
    const move =
      c === "plenty" ? { k: "plenty" as const, a, b } : c === "corner" ? { k: "corner" as const, r } : { k: c as "knight" | "roads" };
    return act(move).then(onClose);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Your cards" closable>
      {kinds.map((c) => {
        const count = held.filter((h) => h.c === c).length;
        const why = cantPlay(state, seat, held, c);
        return (
          <section key={c} data-card={c} className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3" aria-label={CARD_NAMES[c]}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-heading">{CARD_NAMES[c]}</span>
              {count > 1 && <span className="font-display text-callout text-muted-foreground">×{count}</span>}
            </div>
            <p className="text-callout text-muted-foreground">{CARD_TEXT[c]}</p>
            {c === "plenty" && !why && (
              <>
                <ResPicker label="First resource" value={a} onChange={setA} />
                <ResPicker label="Second resource" value={b} onChange={setB} />
              </>
            )}
            {c === "corner" && !why && <ResPicker label="Resource to corner" value={r} onChange={setR} />}
            {c !== "point" && (
              <AsyncButton size="lg" className="w-full" disabled={!!why} onClick={() => play(c)}>
                {c === "plenty"
                  ? `Take ${a === b ? `2 ${resName(a)}` : `${resName(a)} and ${resName(b)}`}`
                  : c === "corner"
                    ? `Take everyone's ${resName(r)}`
                    : `Play ${CARD_NAMES[c]}`}
              </AsyncButton>
            )}
            {why && c !== "point" && <p className="text-footnote text-muted-foreground">{why}</p>}
          </section>
        );
      })}
    </Sheet>
  );
}
