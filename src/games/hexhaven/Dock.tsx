import { useState, type ReactNode } from "react";
import { CastleTurretIcon, DiceFiveIcon, HandshakeIcon, HouseLineIcon, PathIcon, ScrollIcon, SwordIcon } from "@phosphor-icons/react";
import { noHand } from "../../../convex/hexhaven/board";
import { actor, cantBuild, handSize, victimsAt, type Held, type HexState } from "../../../convex/hexhaven/engine";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { AsyncButton } from "@/components/AsyncButton";
import { ActionRail, DockNote } from "@/components/game/GameFrame";
import { TurnText } from "@/components/game/TurnText";
import { Result } from "@/components/match";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { Pick } from "./Board";
import { cantPlay } from "./CardsSheet";
import { Counts, HandRow, useHexMove } from "./parts";
import { offersFor } from "./TradeSheet";

export type Building = "road" | "village" | "town";

const PIECE_ICON = { road: PathIcon, village: HouseLineIcon, town: CastleTurretIcon } as const;
const PIECE_NAME = { road: "Road", village: "Settlement", town: "City" } as const;

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-primary text-caption font-bold text-primary-foreground">
      {n}
    </span>
  );
}

export function Dock({
  match,
  meId,
  state,
  mySeat,
  held,
  gained,
  pick,
  chosen,
  building,
  setBuilding,
  onDone,
  onTrade,
  onCards,
}: {
  match: MatchView;
  meId: Id<"users"> | undefined;
  state: HexState;
  mySeat: number;
  held: Held[];
  gained: number[];
  pick: Pick | null;
  chosen: number | null;
  building: Building | null;
  setBuilding: (b: Building | null) => void;
  onDone: () => void;
  onTrade: () => void;
  onCards: () => void;
}) {
  const act = useHexMove(match._id, state.seq);
  const [discarding, setDiscarding] = useState(false);
  if (match.status === "finished") return <Result match={match} meId={meId} />;
  const me = mySeat >= 0 ? state.players[mySeat] : undefined;
  if (!me) return <DockNote>You're watching.</DockNote>;
  if (me.out) return <DockNote>You left this game.</DockNote>;
  const ph = state.phase;
  const up = actor(state);
  const upPlayer = match.players[up];
  const offers = offersFor(state, mySeat).length;
  const playable = held.filter((h) => !cantPlay(state, mySeat, held, h.c) && h.c !== "point");
  const owe = ph.k === "discard" ? (ph.owe[mySeat] ?? 0) : 0;

  const confirm = (label: string, onClick: () => Promise<void>, cancel?: () => void) => (
    <ActionRail className="gap-2">
      {cancel && (
        <Button variant="card" size="dock" onClick={cancel}>
          Cancel
        </Button>
      )}
      <AsyncButton size="dock" className="col-span-2 text-callout" disabled={chosen === null} onClick={onClick}>
        {chosen === null ? "Tap a spot" : label}
      </AsyncButton>
    </ActionRail>
  );

  let main: ReactNode;
  if (ph.k === "setup" && up === mySeat && pick) {
    main =
      chosen === null ? (
        <DockNote>{pick.kind === "village" ? "Tap a spot for your settlement." : "Tap where its road goes."}</DockNote>
      ) : (
        confirm(pick.kind === "village" ? "Settle here" : "Build the road", () =>
          act({ k: pick.kind as "village" | "road", at: chosen }).then(onDone),
        )
      );
  } else if (ph.k === "discard" && owe > 0) {
    main = (
      <Button size="xl" className="h-[60px] w-full" onClick={() => setDiscarding(true)}>
        Give back {owe} cards
      </Button>
    );
  } else if (ph.k === "bandit" && up === mySeat) {
    if (chosen === null) main = <DockNote>Tap a hex to move the robber.</DockNote>;
    else {
      const victims = victimsAt(state, mySeat, chosen);
      main = (
        <ActionRail className="gap-2">
          {victims.length === 0 ? (
            <AsyncButton size="dock" className="text-callout" onClick={() => act({ k: "bandit", hex: chosen, from: -1 }).then(onDone)}>
              Move the robber here
            </AsyncButton>
          ) : (
            victims.map((v) => (
              <AsyncButton
                key={v}
                size="dock"
                className="text-callout"
                icon={<SwordIcon weight="fill" />}
                onClick={() => act({ k: "bandit", hex: chosen, from: v }).then(onDone)}
              >
                {`Rob ${match.players[v].name}`}
              </AsyncButton>
            ))
          )}
        </ActionRail>
      );
    }
  } else if (ph.k === "roads" && up === mySeat) {
    main =
      chosen === null ? (
        <ActionRail className="grid-cols-[2fr_1fr] gap-2">
          <DockNote>{`Tap where a free road goes (${ph.left} left).`}</DockNote>
          <AsyncButton variant="card" size="dock" onClick={() => act({ k: "doneRoads" })}>
            Done
          </AsyncButton>
        </ActionRail>
      ) : (
        confirm("Build the road", () => act({ k: "road", at: chosen }).then(onDone))
      );
  } else if (ph.k === "roll" && up === mySeat) {
    main = (
      <ActionRail className="gap-2">
        {playable.some((h) => h.c === "knight") && (
          <AsyncButton variant="card" size="dock" icon={<SwordIcon weight="bold" />} onClick={() => act({ k: "knight" })}>
            Knight first
          </AsyncButton>
        )}
        <AsyncButton size="dock" className="col-span-2" icon={<DiceFiveIcon weight="fill" />} onClick={() => act({ k: "roll" })}>
          Roll
        </AsyncButton>
      </ActionRail>
    );
  } else if (ph.k === "main" && up === mySeat && building) {
    main = confirm(
      `Build ${PIECE_NAME[building].toLowerCase()} here`,
      () =>
        act({ k: building, at: chosen! })
          .then(() => setBuilding(null))
          .then(onDone),
      () => setBuilding(null),
    );
  } else if (ph.k === "main" && up === mySeat) {
    main = (
      <ActionRail className="grid-cols-4 gap-2 phone-landscape:grid phone-landscape:grid-flow-row phone-landscape:grid-cols-2">
        {(["road", "village", "town"] as const).map((k) => {
          const Icon = PIECE_ICON[k];
          const why = cantBuild(state, mySeat, k);
          return (
            <Button
              key={k}
              variant="card"
              size="dock"
              className="px-1"
              disabled={!!why}
              aria-description={why ?? undefined}
              onClick={() => setBuilding(k)}
            >
              <Icon weight="bold" />
              {PIECE_NAME[k]}
            </Button>
          );
        })}
        <AsyncButton
          variant="card"
          size="dock"
          disabled={!!cantBuild(state, mySeat, "card")}
          icon={<ScrollIcon weight="bold" />}
          onClick={() => act({ k: "buy" })}
        >
          Buy card
        </AsyncButton>
      </ActionRail>
    );
  } else {
    main = (
      <DockNote>
        <TurnText up={upPlayer} meId={meId} />
        {ph.k === "discard" && <span>&nbsp;to give back cards</span>}
      </DockNote>
    );
  }

  const endTurn = ph.k === "main" && up === mySeat && !building;
  return (
    <div className="flex flex-col gap-2" data-dock data-phase={ph.k} data-mine={up === mySeat ? "" : undefined}>
      <HandRow hand={me.res} gained={gained} />
      <div className="min-h-[60px]">{main}</div>
      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" className="relative h-11" onClick={onTrade}>
          <HandshakeIcon weight="bold" /> Trade
          <Badge n={offers} />
        </Button>
        <Button variant="secondary" className="relative h-11" onClick={onCards} disabled={held.length === 0}>
          <ScrollIcon weight="bold" /> Cards
          <Badge n={playable.length ? held.length : 0} />
        </Button>
        {endTurn ? (
          <AsyncButton className="h-11" onClick={() => act({ k: "end" })}>
            End turn
          </AsyncButton>
        ) : (
          <span className="grid h-11 place-items-center text-footnote text-muted-foreground tabular-nums">{handSize(me.res)} cards</span>
        )}
      </div>
      <DiscardSheet open={discarding && owe > 0} onClose={() => setDiscarding(false)} match={match} state={state} seat={mySeat} owe={owe} />
    </div>
  );
}

function DiscardSheet({
  open,
  onClose,
  match,
  state,
  seat,
  owe,
}: {
  open: boolean;
  onClose: () => void;
  match: MatchView;
  state: HexState;
  seat: number;
  owe: number;
}) {
  const act = useHexMove(match._id, state.seq);
  const [res, setRes] = useState(noHand);
  const picked = handSize(res);
  return (
    <Sheet open={open} onClose={onClose} title={`Give back ${owe}`} closable>
      <Counts label="Give back" value={res} max={state.players[seat].res} onChange={setRes} />
      <AsyncButton
        size="xl"
        className="w-full"
        disabled={picked !== owe}
        onClick={() =>
          act({ k: "discard", res }).then(() => {
            setRes(noHand());
            onClose();
          })
        }
      >
        {picked === owe ? `Give back ${owe}` : picked < owe ? `Pick ${owe - picked} more` : `${picked - owe} too many`}
      </AsyncButton>
    </Sheet>
  );
}
