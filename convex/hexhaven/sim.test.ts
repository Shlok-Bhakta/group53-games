import { expect, test } from "vitest";
import { LAYOUTS, PIECES, geometryOf } from "./board";
import {
  DEFAULT_RULES,
  act,
  actor,
  alive,
  bankOf,
  newGame,
  publicPoints,
  roadsOf,
  townsOf,
  villagesOf,
  type Game,
  type Rules,
} from "./engine";
import { botMove, nextBotSeat } from "./bot";

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function check(g: Game) {
  const s = g.s;
  const fail = (why: string) => {
    throw new Error(`${why} (after ${JSON.stringify(g.events.slice(-3))})`);
  };
  const geo = geometryOf(s.layout);
  const supply = LAYOUTS[s.layout].supply;
  for (const n of bankOf(s)) if (n < 0 || n > supply) fail("The bank's count is off");
  for (const p of s.players) if (p.res.some((n) => n < 0 || !Number.isInteger(n))) fail("A hand went negative");
  for (const [i, p] of s.players.entries()) {
    if (p.out && p.res.some((n) => n)) fail("An out player kept cards");
    if (roadsOf(s, i) > PIECES.road || villagesOf(s, i) > PIECES.village || townsOf(s, i) > PIECES.town) fail("Too many pieces");
    if (p.devs !== g.held[i].length) fail("Card count doesn't match the hidden hand");
  }
  if (g.deck.length !== s.deckLeft) fail("The deck count is off");
  const dealt = g.deck.length + g.held.reduce((a, h) => a + h.length, 0);
  const deckSize = Object.values(LAYOUTS[s.layout].deck).reduce((a, b) => a + b, 0);
  if (dealt > deckSize) fail("Cards appeared from nowhere");
  for (const [v, spot] of s.spots.entries()) {
    if (!spot) continue;
    if (geo.verts[v].near.some((w) => s.spots[w])) fail("Villages too close");
  }
  if (s.phase.k === "over") return;
  if (s.players[actor(s)].out) fail("Waiting on someone who's out");
  if (s.phase.k === "discard" && s.phase.owe.every((o) => o === 0)) fail("Discard phase with nothing owed");
  if (s.phase.k !== "setup" && publicPoints(s, s.current) >= s.rules.points) fail("Someone has the points but the game goes on");
}

const MIXES: Partial<Rules>[] = [{}, { points: 8 }, { friendly: true, limit: 9 }, { balanced: false, points: 12 }];
const CAP = 6000;

for (const n of [2, 3, 4, 5, 6])
  for (const [m, mix] of MIXES.entries())
    test(`bots play whole games: ${n} players, rule mix ${m}`, () => {
      let finished = 0;
      const games = n > 4 ? 6 : 10;
      for (let k = 0; k < games; k++) {
        const rng = mulberry(1000 * n + 100 * m + k);
        let g = newGame(n, { ...DEFAULT_RULES, ...mix }, rng);
        for (let step = 0; step < CAP && g.s.phase.k !== "over"; step++) {
          const seat = nextBotSeat(g.s, () => false);
          if (seat === null) throw new Error("Nobody to move");
          const a = botMove(g, seat, rng);
          if (!a) throw new Error(`Bot ${seat} had no move in ${g.s.phase.k}`);
          if (step === 3000 && n > 2 && k === 0)
            g = act(
              g,
              alive(g.s).find((i) => i !== g.s.current)!,
              { k: "resign" },
              rng,
            );
          else g = act(g, seat, a, rng);
          check(g);
        }
        if (g.s.phase.k === "over") finished++;
      }
      expect(finished).toBeGreaterThan(games / 2);
    });
