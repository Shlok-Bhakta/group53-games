import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { startBackend, stopBackend, waitForUrl } from "./backend.mjs";

const b = await startBackend();
const admin = new ConvexHttpClient(b.url);
admin.setAdminAuth(b.adminKey);
const player = async (name, image) => {
  const p = await admin.action(anyApi.testing.createPlayer, { name, image });
  const client = new ConvexHttpClient(b.url);
  client.setAuth(p.token);
  return { ...p, client };
};
const a = await player(
  "WashableBowl700",
  "https://cdn.discordapp.com/avatars/719077732042014761/44639fc5bce7c79f99de5625f7fed7a8.png?size=256",
);
const c = await player("chrisis14", "https://cdn.discordapp.com/avatars/492431153375084547/f69aa29f75cacbf294c0d465c351d701.png?size=256");
const id = await a.client.mutation(anyApi.matches.queue, { mode: "chess:classic" });
await c.client.mutation(anyApi.matches.queue, { mode: "chess:classic" });
const m = await admin.query(anyApi.testing.getMatch, { id });
const white = m.players.find((p) => p.color === "w").userId === a.userId ? a : c;
const black = white === a ? c : a;
for (const [p, from, to] of [
  [white, "e2", "e4"],
  [black, "e7", "e5"],
  [white, "g1", "f3"],
  [black, "b8", "c6"],
  [white, "f1", "c4"],
]) {
  await p.client.mutation(anyApi.chess.move, { id, from, to });
}

const s4 = await player("samwise");
const a4 = await player("alex_dev");
const four = [a, c, s4, a4];
const fid = await admin.action(anyApi.testing.startFour, { mode: "chess:four", players: four.map((p) => p.userId) });
const sq = (s) => ({ x: s.charCodeAt(0) - 97, y: Number(s.slice(1)) - 1 });
for (const [i, from, to] of [
  [0, "e2", "e4"],
  [1, "b5", "d5"],
  [2, "f13", "f11"],
  [3, "m10", "k10"],
]) {
  const f = sq(from);
  const t = sq(to);
  await four[i].client.mutation(anyApi.chess.fourMove, { id: fid, fromX: f.x, fromY: f.y, toX: t.x, toY: t.y });
}

const sid = await a.client.mutation(anyApi.matches.queue, { mode: "scrabble:classic" });
await c.client.mutation(anyApi.matches.queue, { mode: "scrabble:classic" });
await s4.client.mutation(anyApi.matches.queue, { mode: "scrabble:classic" });
await a.client.mutation(anyApi.matches.startGame, { id: sid });
const sm = await admin.query(anyApi.testing.getMatch, { id: sid });
for (const [seat, word, cells] of [
  [
    0,
    "QUIZ",
    [
      [6, 7],
      [7, 7],
      [8, 7],
      [9, 7],
    ],
  ],
  [
    1,
    "ONE",
    [
      [9, 8],
      [9, 9],
      [9, 10],
    ],
  ],
]) {
  const userId = sm.players[seat].userId;
  const rack = await admin.mutation(anyApi.testing.setRack, { id: sid, userId, letters: word.padEnd(7, "E") });
  await admin.mutation(anyApi.testing.playAs, { id: sid, userId, tiles: cells.map(([x, y], i) => ({ id: rack[i].id, x, y })) });
}

const pid = await a.client.mutation(anyApi.matches.queue, { mode: "poker:holdem" });
await c.client.mutation(anyApi.matches.queue, { mode: "poker:holdem" });
await s4.client.mutation(anyApi.matches.queue, { mode: "poker:holdem" });
await a.client.mutation(anyApi.matches.startGame, { id: pid });
const byUser = new Map([a, c, s4].map((p) => [p.userId, p]));
for (let i = 0; i < 3; i++) {
  const pm = await admin.query(anyApi.testing.getMatch, { id: pid });
  if (pm.state.street > 0) break;
  const p = byUser.get(pm.players[pm.state.turn].userId);
  const owe = pm.state.current - pm.state.bets[pm.state.turn];
  await p.client.mutation(anyApi.poker.move, { id: pid, hand: pm.state.hand, street: pm.state.street, kind: owe > 0 ? "call" : "check" });
}

const lid = await a.client.mutation(anyApi.matches.queue, { mode: "landlord:classic" });
await c.client.mutation(anyApi.matches.queue, { mode: "landlord:classic" });
await s4.client.mutation(anyApi.matches.queue, { mode: "landlord:classic" });
await a.client.mutation(anyApi.matches.startGame, { id: lid });
await admin.mutation(anyApi.testing.landlordBots, { id: lid, steps: 120 });

const hid = await a.client.mutation(anyApi.matches.queue, { mode: "hexhaven:classic" });
await c.client.mutation(anyApi.matches.queue, { mode: "hexhaven:classic" });
await s4.client.mutation(anyApi.matches.queue, { mode: "hexhaven:classic" });
await a.client.mutation(anyApi.matches.startGame, { id: hid });
for (let i = 0; i < 8; i++) await admin.mutation(anyApi.testing.hexhavenBots, { id: hid, steps: 20 });

const wid = await a.client.mutation(anyApi.matches.queue, { mode: "wordle:classic" });
await c.client.mutation(anyApi.matches.queue, { mode: "wordle:classic" });
await s4.client.mutation(anyApi.matches.queue, { mode: "wordle:classic" });
await a.client.mutation(anyApi.matches.startGame, { id: wid });
for (const [who, words] of [
  [a, ["pious", "crane"]],
  [c, ["ghost", "brick", "flame"]],
  [s4, ["shard"]],
]) {
  const answer = await admin.query(anyApi.testing.wordleWord, { id: wid });
  for (const w of [...words.filter((x) => x !== answer), answer])
    await admin.mutation(anyApi.testing.wordleGuessAs, { id: wid, userId: who.userId, word: w });
  await admin.mutation(anyApi.testing.wordlePickAs, { id: wid, userId: who.userId, item: null });
}

const uid = await a.client.mutation(anyApi.matches.queue, { mode: "uno:nomercy" });
await c.client.mutation(anyApi.matches.queue, { mode: "uno:nomercy" });
await s4.client.mutation(anyApi.matches.queue, { mode: "uno:nomercy" });
await a.client.mutation(anyApi.matches.startGame, { id: uid });
await admin.mutation(anyApi.testing.unoDeal, {
  id: uid,
  hands: [["wW10", "r3", "g4"], ["b1", "b2", "y5", "y6", "r9"], ["g1"]],
  top: "rD2",
  turn: 0,
});
const um = await admin.query(anyApi.testing.getMatch, { id: uid });
await admin.mutation(anyApi.testing.unoMoveAs, {
  id: uid,
  userId: um.players[0].userId,
  action: { kind: "play", card: "wW10", color: "b" },
});

const day = Date.parse("2026-10-30T08:00:00Z");
const walk = (base, k) =>
  Array.from({ length: 16 * 60 }, (_, i) => [
    day + i * 60_000,
    +(base * (1 + 0.012 * Math.sin(i / (30 + k)) + i * 0.00002 * (k - 1))).toFixed(2),
  ]);
await admin.mutation(anyApi.stonks.holdings, {
  asOf: "2026-10-29",
  holdings: [
    { symbol: "NVDA", name: "NVIDIA CORP", weight: 7.77, base: 200 },
    { symbol: "AAPL", name: "APPLE INC", weight: 7.65, base: 270 },
  ],
});
for (const [k, symbol, base, name] of [
  [0, "^GSPC", 6800, "S&P 500"],
  [2, "NVDA", 200, "NVIDIA Corporation"],
  [0.2, "AAPL", 270, "Apple Inc."],
]) {
  const points = walk(base, k);
  await admin.mutation(anyApi.stonks.series, { symbol, range: "1D", points, prevClose: base, name });
  await admin.mutation(anyApi.stonks.ingest, {
    ticks: [{ symbol, price: points.at(-1)[1], time: points.at(-1)[0], recv: Date.now(), source: "yahoo", session: "post" }],
  });
}

mkdirSync("e2e/.state", { recursive: true });
writeFileSync("e2e/.state/admin_key", b.adminKey);
const pieces = spawn("python3", ["-m", "http.server", "8789", "-d", "public"], { stdio: "ignore" });
const og = spawn("node", ["og/server.mjs"], {
  env: {
    ...process.env,
    CONVEX_URL: b.url,
    ADMIN_KEY_FILE: "e2e/.state/admin_key",
    PORT: "8788",
    PIECES_URL: "http://127.0.0.1:8789/pieces",
  },
  stdio: "inherit",
});
await Promise.all([waitForUrl("http://127.0.0.1:8788/og/health"), waitForUrl("http://127.0.0.1:8789/")]);
try {
  const html = await (await fetch(`http://127.0.0.1:8788/chess/${id}`)).text();
  console.log(
    html
      .split("\n")
      .filter((l) => /og:(title|description)"/.test(l))
      .join("\n"),
  );
  const img = html.match(/og\/match\/[a-z0-9]+\.png\?v=[a-z0-9]+/)[0];
  writeFileSync("e2e/.state/og-match.png", Buffer.from(await (await fetch(`http://127.0.0.1:8788/${img}`)).arrayBuffer()));
  const html4 = await (await fetch(`http://127.0.0.1:8788/chess/${fid}`)).text();
  console.log(
    html4
      .split("\n")
      .filter((l) => /og:(title|description)"/.test(l))
      .join("\n"),
  );
  const img4 = html4.match(/og\/match\/[a-z0-9]+\.png\?v=[a-z0-9]+/)[0];
  writeFileSync("e2e/.state/og-four.png", Buffer.from(await (await fetch(`http://127.0.0.1:8788/${img4}`)).arrayBuffer()));
  const htmlS = await (await fetch(`http://127.0.0.1:8788/scrabble/${sid}`)).text();
  console.log(
    htmlS
      .split("\n")
      .filter((l) => /og:(title|description)"/.test(l))
      .join("\n"),
  );
  const imgS = htmlS.match(/og\/match\/[a-z0-9]+\.png\?v=[a-z0-9]+/)[0];
  writeFileSync("e2e/.state/og-scrabble-match.png", Buffer.from(await (await fetch(`http://127.0.0.1:8788/${imgS}`)).arrayBuffer()));
  const htmlP = await (await fetch(`http://127.0.0.1:8788/poker/${pid}`)).text();
  console.log(
    htmlP
      .split("\n")
      .filter((l) => /og:(title|description)"/.test(l))
      .join("\n"),
  );
  const imgP = htmlP.match(/og\/match\/[a-z0-9]+\.png\?v=[a-z0-9]+/)[0];
  writeFileSync("e2e/.state/og-poker-match.png", Buffer.from(await (await fetch(`http://127.0.0.1:8788/${imgP}`)).arrayBuffer()));
  const htmlL = await (await fetch(`http://127.0.0.1:8788/monopoly/${lid}`)).text();
  console.log(
    htmlL
      .split("\n")
      .filter((l) => /og:(title|description)"/.test(l))
      .join("\n"),
  );
  const imgL = htmlL.match(/og\/match\/[a-z0-9]+\.png\?v=[a-z0-9]+/)[0];
  const oldimgL = await (await fetch(`http://127.0.0.1:8788/landlord/${lid}`)).text();
  assert.ok(oldimgL.includes(imgL));
  writeFileSync("e2e/.state/og-landlord-match.png", Buffer.from(await (await fetch(`http://127.0.0.1:8788/${imgL}`)).arrayBuffer()));
  const htmlH = await (await fetch(`http://127.0.0.1:8788/catan/${hid}`)).text();
  console.log(
    htmlH
      .split("\n")
      .filter((l) => /og:(title|description)"/.test(l))
      .join("\n"),
  );
  const imgH = htmlH.match(/og\/match\/[a-z0-9]+\.png\?v=[a-z0-9]+/)[0];
  const oldimgH = await (await fetch(`http://127.0.0.1:8788/hexhaven/${hid}`)).text();
  assert.ok(oldimgH.includes(imgH));
  writeFileSync("e2e/.state/og-hexhaven-match.png", Buffer.from(await (await fetch(`http://127.0.0.1:8788/${imgH}`)).arrayBuffer()));
  writeFileSync(
    "e2e/.state/og-hexhaven.png",
    Buffer.from(await (await fetch("http://127.0.0.1:8788/og/image/hexhaven.png")).arrayBuffer()),
  );
  const htmlU = await (await fetch(`http://127.0.0.1:8788/uno/${uid}`)).text();
  const imgU = htmlU.match(/og\/match\/[a-z0-9]+\.png\?v=[a-z0-9]+/)[0];
  writeFileSync("e2e/.state/og-uno-match.png", Buffer.from(await (await fetch(`http://127.0.0.1:8788/${imgU}`)).arrayBuffer()));
  writeFileSync("e2e/.state/og-uno.png", Buffer.from(await (await fetch("http://127.0.0.1:8788/og/image/uno.png")).arrayBuffer()));
  const htmlW = await (await fetch(`http://127.0.0.1:8788/wordle/${wid}`)).text();
  const imgW = htmlW.match(/og\/match\/[a-z0-9]+\.png\?v=[a-z0-9]+/)[0];
  writeFileSync("e2e/.state/og-wordle-match.png", Buffer.from(await (await fetch(`http://127.0.0.1:8788/${imgW}`)).arrayBuffer()));
  writeFileSync(
    "e2e/.state/og-landlord.png",
    Buffer.from(await (await fetch("http://127.0.0.1:8788/og/image/landlord.png")).arrayBuffer()),
  );
  writeFileSync("e2e/.state/og-poker.png", Buffer.from(await (await fetch("http://127.0.0.1:8788/og/image/poker.png")).arrayBuffer()));
  writeFileSync(
    "e2e/.state/og-scrabble.png",
    Buffer.from(await (await fetch("http://127.0.0.1:8788/og/image/scrabble.png")).arrayBuffer()),
  );
  for (const [path, file] of [
    ["/stonks", "og-stonks.png"],
    ["/stonks/NVDA", "og-stonks-nvda.png"],
  ]) {
    const htmlT = await (await fetch(`http://127.0.0.1:8788${path}`)).text();
    console.log(
      htmlT
        .split("\n")
        .filter((l) => /og:(title|description)"/.test(l))
        .join("\n"),
    );
    const imgT = htmlT.match(/og\/stonks\/[^"]+\.png\?v=[a-z0-9]+/)[0];
    writeFileSync(`e2e/.state/${file}`, Buffer.from(await (await fetch(`http://127.0.0.1:8788/${imgT}`)).arrayBuffer()));
  }
  writeFileSync("e2e/.state/og-chess.png", Buffer.from(await (await fetch("http://127.0.0.1:8788/og/image/chess.png")).arrayBuffer()));
} finally {
  og.kill();
  pieces.kill();
  stopBackend(b.name);
}
