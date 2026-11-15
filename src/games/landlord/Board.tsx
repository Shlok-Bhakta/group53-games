import { memo, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  BusIcon,
  CarIcon,
  CoinsIcon,
  DropIcon,
  LightningIcon,
  LockIcon,
  QuestionIcon,
  ReceiptIcon,
  SirenIcon,
  TrainIcon,
} from "@phosphor-icons/react";
import { BOARD, JAIL, type Square } from "../../../convex/landlord/board";
import type { MonoState, Prop } from "../../../convex/landlord/engine";
import type { MatchView } from "../../../convex/matches";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Tiles } from "@/Tiles";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";
import type { Camera } from "./camera";
import { C, SIDE, boxOf, spotOf, type Box } from "./geometry";
import { money } from "../../../convex/landlord/text";

const TOKEN = 34;

export function Board({
  camera,
  state,
  match,
  highlight,
  picking,
  onSquare,
}: {
  camera: Camera;
  state: MonoState;
  match: MatchView;
  highlight: number | null;
  picking: boolean;
  onSquare: (pos: number) => void;
}) {
  return (
    <motion.div
      className="ll-board absolute left-0 top-0"
      style={{ width: SIDE, height: SIDE, x: camera.x, y: camera.y, scale: camera.k, originX: 0, originY: 0 }}
    >
      {BOARD.map((sq, pos) => (
        <Cell
          key={pos}
          pos={pos}
          sq={sq}
          prop={state.props[pos]}
          owner={ownerOf(match, state.props[pos])}
          lit={highlight === pos}
          picking={picking}
          onTap={onSquare}
        />
      ))}
      <Middle state={state} />
      <Tokens state={state} match={match} />
    </motion.div>
  );
}

const ownerOf = (match: MatchView, prop: Prop | null) => (prop && prop.owner >= 0 ? match.players[prop.owner] : undefined);

const Cell = memo(function Cell({
  pos,
  sq,
  prop,
  owner,
  lit,
  picking,
  onTap,
}: {
  pos: number;
  sq: Square;
  prop: Prop | null;
  owner: MatchView["players"][number] | undefined;
  lit: boolean;
  picking: boolean;
  onTap: (pos: number) => void;
}) {
  const b = boxOf(pos);
  const inner = b.edge === "bottom" ? "top" : b.edge === "top" ? "bottom" : b.edge === "left" ? "right" : "left";
  const color = owner ? seatColor(owner) : undefined;
  return (
    <Button
      variant="bare"
      size="overlay"
      className={cn("ll-sq absolute flex transition-shadow duration-200 ease-[ease]", lit && "ll-lit", picking && "ll-pickable")}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
      onClick={() => onTap(pos)}
      aria-label={label(sq, prop, owner?.name)}
      data-pos={pos}
      data-owner={prop?.owner ?? undefined}
    >
      {sq.kind === "street" && <Band group={sq.group} side={inner} houses={prop?.houses ?? 0} />}
      <Face sq={sq} box={b} />
      {owner && (
        <>
          <span className="ll-owner" data-side={b.edge} style={{ background: color }} />
          <span className="ll-owner-face" data-side={b.edge}>
            <PlayerAvatar player={owner} size={20} seat={color} />
          </span>
        </>
      )}
      {prop?.mortgaged && <span className="ll-mortgaged">Mortgaged</span>}
    </Button>
  );
});

function label(sq: Square, prop: Prop | null, owner?: string) {
  const bits = [sq.name];
  if ("price" in sq) bits.push(owner ? `owned by ${owner}` : `${money(sq.price)}, for sale`);
  if (prop?.houses) bits.push(prop.houses === 5 ? "a hotel" : `${prop.houses} ${prop.houses === 1 ? "house" : "houses"}`);
  if (prop?.mortgaged) bits.push("mortgaged");
  return bits.join(", ");
}

function Band({ group, side, houses }: { group: string; side: string; houses: number }) {
  return (
    <span className="ll-band" data-group={group} data-side={side}>
      {houses === 5 ? <span className="ll-hotel" /> : Array.from({ length: houses }, (_, i) => <span key={i} className="ll-house" />)}
    </span>
  );
}

const ICONS: Partial<Record<Square["kind"], ReactNode>> = {
  chance: <QuestionIcon weight="bold" />,
  chest: <CoinsIcon weight="fill" />,
  tax: <ReceiptIcon weight="fill" />,
  rail: <TrainIcon weight="fill" />,
};

function Face({ sq, box }: { sq: Square; box: Box }) {
  const corner = box.edge === "corner";
  const icon =
    sq.kind === "util" ? (
      sq.name === "Water Works" ? (
        <DropIcon weight="fill" />
      ) : (
        <LightningIcon weight="fill" />
      )
    ) : sq.kind === "go" ? (
      <span className="font-display text-heading">GO</span>
    ) : sq.kind === "jail" ? (
      <LockIcon weight="fill" />
    ) : sq.kind === "parking" ? (
      <CarIcon weight="fill" />
    ) : sq.kind === "gotojail" ? (
      <SirenIcon weight="fill" />
    ) : (
      ICONS[sq.kind]
    );
  const sub = sq.kind === "go" ? "Collect $200" : "price" in sq ? money(sq.price) : sq.kind === "tax" ? `Pay ${money(sq.amount)}` : null;
  return (
    <span className={cn("ll-face", corner && "ll-corner", sq.kind === "street" && `ll-banded-${box.edge}`)}>
      {sq.kind !== "go" && <span className="ll-name">{sq.name}</span>}
      {icon && <span className="ll-icon">{icon}</span>}
      {sub && <span className="ll-price">{sub}</span>}
    </span>
  );
}

function Middle({ state }: { state: MonoState }) {
  const inner = SIDE - 2 * C;
  return (
    <div
      className="ll-middle absolute flex flex-col items-center justify-center gap-6"
      style={{ left: C, top: C, width: inner, height: inner }}
    >
      <Tiles word="MONOPOLY" states={["green", "yellow", "green", "gray", "green", "yellow", "green", "hit"]} size="lg" label="Monopoly" />
      <div className="flex gap-8 text-center">
        {state.rules.pot > 0 && (
          <div>
            <div className="font-display text-title tabular-nums">{money(state.pot)}</div>
            <div className="text-callout opacity-70">Jackpot</div>
          </div>
        )}
        {state.rules.limited && (
          <>
            <div>
              <div className="font-display text-title tabular-nums">{state.bank.houses}</div>
              <div className="text-callout opacity-70">Houses</div>
            </div>
            <div>
              <div className="font-display text-title tabular-nums">{state.bank.hotels}</div>
              <div className="text-callout opacity-70">Hotels</div>
            </div>
          </>
        )}
      </div>
      {state.rules.speed && (
        <div className="flex items-center gap-2 text-callout opacity-70">
          <BusIcon weight="fill" /> Speed die from your second lap
        </div>
      )}
    </div>
  );
}

function Tokens({ state, match }: { state: MonoState; match: MatchView }) {
  const at = new Map<string, number[]>();
  state.players.forEach((p, seat) => {
    if (p.out) return;
    const key = `${p.pos}:${p.jail >= 0 && p.pos === JAIL ? "in" : "out"}`;
    at.set(key, [...(at.get(key) ?? []), seat]);
  });
  return (
    <>
      {state.players.map((p, seat) => {
        if (p.out) return null;
        const jailed = p.jail >= 0 && p.pos === JAIL;
        const here = at.get(`${p.pos}:${jailed ? "in" : "out"}`)!;
        const spot = spotOf(p.pos, here.indexOf(seat), here.length, jailed);
        const player = match.players[seat];
        return (
          <motion.div
            key={seat}
            className="pointer-events-none absolute left-0 top-0"
            data-token={seat}
            data-pos={p.pos}
            initial={false}
            animate={{ x: spot.x - TOKEN / 2, y: spot.y - TOKEN / 2 }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
            style={{ zIndex: seat === state.current ? 3 : 2 }}
          >
            <motion.div initial={false} animate={{ scale: seat === state.current ? 1.12 : 1 }}>
              <PlayerAvatar player={player} size={TOKEN} seat={seatColor(player)} />
            </motion.div>
          </motion.div>
        );
      })}
    </>
  );
}
