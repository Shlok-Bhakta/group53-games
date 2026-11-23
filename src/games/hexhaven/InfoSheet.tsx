import type { ReactNode } from "react";
import { ANY_PORT, COSTS, DESERT, LAYOUTS, PIECES, RESOURCE_NAMES, TERRAIN_NAMES, pips, type Piece } from "../../../convex/hexhaven/board";
import {
  ARMY_MIN,
  AWARD_POINTS,
  LONGEST_MIN,
  bankOf,
  cantBuild,
  geo,
  rateFor,
  roadsOf,
  supplyOf,
  townsOf,
  villagesOf,
  type HexState,
} from "../../../convex/hexhaven/engine";
import { handText } from "../../../convex/hexhaven/text";
import type { MatchView } from "../../../convex/matches";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { PALETTE } from "./palette";
import { Cost, Fact, Facts, PIECE_NAME, ResIcon, missingFor } from "./parts";

export type Topic = { k: "hex"; i: number } | { k: "port"; i: number } | { k: "res"; r: number } | { k: "piece"; kind: Piece };

const PIECE_POINTS: Record<Piece, string> = { road: "0", village: "1", town: "2", card: "0 or 1" };
const PIECE_WHERE: Record<Piece, string> = {
  road: "Joins your roads or buildings",
  village: "On your road, 2 steps from any building",
  town: "Upgrades your settlement",
  card: "Play one a turn, not the turn you buy it",
};

export function Token({ n, size = 26 }: { n: number; size?: number }) {
  const hot = n === 6 || n === 8;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-display text-footnote font-bold"
      style={{ width: size, height: size, background: PALETTE.token, color: hot ? PALETTE.hot : PALETTE.tokenInk }}
    >
      {n}
    </span>
  );
}

function odds(n: number) {
  return `${pips(n)} in 36`;
}

function buildingsOn(state: HexState, hex: number) {
  const per = new Map<number, number>();
  for (const v of geo(state).hexVerts[hex]) {
    const spot = state.spots[v];
    if (spot) per.set(spot.seat, (per.get(spot.seat) ?? 0) + (spot.town ? 2 : 1));
  }
  return [...per.entries()].sort((a, b) => a[0] - b[0]);
}

function earners(state: HexState, seat: number, r: number) {
  return state.hexes.flatMap((h, i) => {
    if (h.r !== r || h.n === 0) return [];
    const got = buildingsOn(state, i).find(([s]) => s === seat)?.[1] ?? 0;
    return got ? [{ i, n: h.n, got, blocked: state.bandit === i }] : [];
  });
}

export function titleOf(state: HexState, topic: Topic) {
  if (topic.k === "hex") {
    const h = state.hexes[topic.i];
    return h.r === DESERT ? "Desert" : `${TERRAIN_NAMES[h.r]} ${h.n}`;
  }
  if (topic.k === "port") {
    const r = state.ports[topic.i].r;
    return r === ANY_PORT ? "3:1 harbor" : `${RESOURCE_NAMES[r]} harbor`;
  }
  if (topic.k === "res") return RESOURCE_NAMES[topic.r];
  return PIECE_NAME[topic.kind];
}

export function InfoSheet({
  topic,
  onClose,
  match,
  state,
  mySeat,
}: {
  topic: Topic | null;
  onClose: () => void;
  match: MatchView;
  state: HexState;
  mySeat: number;
}) {
  const name = (seat: number) => (seat === mySeat ? "You" : (match.players[seat]?.name ?? "Someone"));
  const who = (seat: number) => (
    <>
      <PlayerAvatar player={match.players[seat]} size={28} seat={seatColor(match.players[seat], state.players[seat]?.out)} />
      <span className="truncate">{name(seat)}</span>
    </>
  );
  const body = () => {
    if (!topic) return null;
    if (topic.k === "hex") return <HexInfo state={state} hex={topic.i} who={who} />;
    if (topic.k === "port") return <PortInfo state={state} port={topic.i} mySeat={mySeat} who={who} />;
    if (topic.k === "res") return <ResInfo state={state} r={topic.r} mySeat={mySeat} />;
    return <PieceInfo state={state} kind={topic.kind} mySeat={mySeat} />;
  };
  return (
    <Sheet open={topic !== null} onClose={onClose} title={topic ? titleOf(state, topic) : ""} closable>
      <div className="flex flex-col gap-1.5" data-info={topic?.k}>
        {body()}
      </div>
    </Sheet>
  );
}

type Who = (seat: number) => ReactNode;

function HexInfo({ state, hex, who }: { state: HexState; hex: number; who: Who }) {
  const h = state.hexes[hex];
  const robbed = state.bandit === hex;
  if (h.r === DESERT)
    return (
      <Facts label="This hex">
        <Fact label="Pays">Nothing</Fact>
        {robbed && <Fact label="Robber">Here</Fact>}
      </Facts>
    );
  const on = buildingsOn(state, hex);
  return (
    <Facts label="This hex">
      <Fact label="Pays">
        <ResIcon r={h.r} size={22} />
        {RESOURCE_NAMES[h.r]}
      </Fact>
      <Fact
        label={
          <>
            <Token n={h.n} /> Comes up
          </>
        }
      >
        {odds(h.n)} rolls
      </Fact>
      {robbed && (
        <Fact label="Robber" tone="bad">
          Pays nobody
        </Fact>
      )}
      {on.map(([seat, got]) => (
        <Fact key={seat} label={who(seat)} tone={robbed ? undefined : "good"}>
          {robbed ? `0 of ${got}` : `+${got}`}
          <ResIcon r={h.r} size={18} />
        </Fact>
      ))}
    </Facts>
  );
}

function PortInfo({ state, port, mySeat, who }: { state: HexState; port: number; mySeat: number; who: Who }) {
  const p = state.ports[port];
  const edge = geo(state).edges[p.e];
  const owners = [...new Set([edge.a, edge.b].flatMap((v) => (state.spots[v] ? [state.spots[v]!.seat] : [])))].sort((a, b) => a - b);
  const any = p.r === ANY_PORT;
  return (
    <Facts label="This harbor">
      <Fact label="Trade">
        {any ? (
          "3 of a kind"
        ) : (
          <>
            2 <ResIcon r={p.r} size={20} />
          </>
        )}
        <span className="text-muted-foreground">for</span> any 1
      </Fact>
      {owners.map((seat) => (
        <Fact key={seat} label={who(seat)} tone={seat === mySeat ? "good" : undefined}>
          Settled
        </Fact>
      ))}
      {mySeat >= 0 && !owners.includes(mySeat) && <Fact label="To use it">Settle either corner</Fact>}
    </Facts>
  );
}

function ResInfo({ state, r, mySeat }: { state: HexState; r: number; mySeat: number }) {
  const bank = bankOf(state)[r];
  const playing = mySeat >= 0;
  const rate = playing ? rateFor(state, mySeat, r) : 4;
  const from = playing ? earners(state, mySeat, r) : [];
  const per36 = from.reduce((t, e) => t + (e.blocked ? 0 : pips(e.n) * e.got), 0);
  const builds = (Object.keys(COSTS) as Piece[]).filter((k) => COSTS[k][r] > 0);
  return (
    <Facts label={RESOURCE_NAMES[r]}>
      {playing && <Fact label="You hold">{state.players[mySeat].res[r]}</Fact>}
      <Fact label="Bank has">
        <span>
          {bank}
          <span className="text-muted-foreground">/{supplyOf(state)}</span>
        </span>
      </Fact>
      {playing && <Fact label="Bank trade">{rate === 4 ? "4:1" : `${rate}:1 harbor`}</Fact>}
      {playing && (
        <Fact label="Pays you on">
          {from.length
            ? from.map((e) => (
                <span key={e.i} className={e.blocked ? "opacity-40" : undefined}>
                  <Token n={e.n} />
                </span>
              ))
            : "Nothing yet"}
        </Fact>
      )}
      {per36 > 0 && <Fact label="Per 36 rolls">{`≈ ${per36}`}</Fact>}
      {builds.map((k) => (
        <Fact key={k} label={PIECE_NAME[k]}>
          <Cost kind={k} />
        </Fact>
      ))}
    </Facts>
  );
}

function PieceInfo({ state, kind, mySeat }: { state: HexState; kind: Piece; mySeat: number }) {
  const me = mySeat >= 0 ? state.players[mySeat] : undefined;
  const short = me ? missingFor(me.res, kind) : null;
  const shortBy = short ? short.reduce((a, b) => a + b, 0) : 0;
  const left =
    kind === "road"
      ? PIECES.road - roadsOf(state, mySeat)
      : kind === "village"
        ? PIECES.village - villagesOf(state, mySeat)
        : kind === "town"
          ? PIECES.town - townsOf(state, mySeat)
          : state.deckLeft;
  const of = kind === "card" ? LAYOUTS[state.layout].deck : null;
  const why = me && state.phase.k === "main" && state.current === mySeat ? cantBuild(state, mySeat, kind) : null;
  return (
    <Facts label={PIECE_NAME[kind]}>
      <Fact label="Costs">
        <Cost kind={kind} hand={me?.res} size={22} />
      </Fact>
      {me && (
        <Fact label={shortBy ? "You need" : "You have it"} tone={shortBy ? "bad" : "good"}>
          {shortBy ? handText(short!) : "Ready"}
        </Fact>
      )}
      <Fact label="Points">{PIECE_POINTS[kind]}</Fact>
      {kind === "road" && <Fact label="Longest Road">{`${LONGEST_MIN}+ roads · ${AWARD_POINTS} pts`}</Fact>}
      {kind === "town" && <Fact label="Pays">2 per roll</Fact>}
      {of && <Fact label="Victory Points">{`${of.point} of ${Object.values(of).reduce((a, b) => a + b, 0)}`}</Fact>}
      {of && <Fact label="Knights">{`${of.knight} · Largest Army ${ARMY_MIN}+`}</Fact>}
      <Fact label={kind === "card" ? "In the deck" : "You have left"}>
        <span>
          {left}
          {kind !== "card" && <span className="text-muted-foreground">/{PIECES[kind]}</span>}
        </span>
      </Fact>
      <Fact label={<span className="text-muted-foreground">{PIECE_WHERE[kind]}</span>} />
      {why && !shortBy && <Fact label={why} tone="bad" />}
    </Facts>
  );
}
