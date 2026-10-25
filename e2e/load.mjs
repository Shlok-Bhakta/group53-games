// Load test against a real Convex backend: many simultaneous real-time games, plus async games, with real
// websocket subscriptions, signed sessions, presence heartbeats, and taps.
//
//   node --experimental-strip-types e2e/load.mjs                 local throwaway backend (Docker)
//   node --experimental-strip-types e2e/load.mjs --prod          kiwi. Test helpers are switched on for the run
//                                                               and off again after; test players are flagged so
//                                                               they never send or trigger a push, and they're
//                                                               removed at the end.
// Options: --games 6 --classic 3 --seconds 60
import { execFileSync } from "node:child_process";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { TICK_MS, legalTargets, simulate, initialState } from "../convex/chess/realtime.ts";
import { startBackend, stopBackend } from "./backend.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const PROD = process.argv.includes("--prod");
const GAMES = arg("games", 6);
const CLASSIC = arg("classic", 3);
const SECONDS = arg("seconds", 60);
const PROD_URL = "https://group53-api.shlokbhakta.dev";
const api = anyApi;

const stats = { rtMove: [], propagation: [], classicMove: [], errors: new Map(), rejected: 0, finished: 0, results: new Map() };
const err = (label, e) => {
  const msg = `${label}: ${(e?.message ?? String(e)).split("\n")[0].replace(/\[Request ID: \w+\] /, "").slice(0, 120)}`;
  stats.errors.set(msg, (stats.errors.get(msg) ?? 0) + 1);
};
const pct = (xs, p) => {
  if (!xs.length) return "-";
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Every network call gets a time limit, so a hang names the step instead of stalling the run.
const within = (label, promise, ms = 15_000) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms))]);

let target;
const env = { ...process.env };
if (PROD) {
  const adminKey = execFileSync("ssh", ["kiwi", "cat Services/group53/secrets/admin_key"]).toString().trim();
  Object.assign(env, { CONVEX_SELF_HOSTED_URL: "http://100.88.30.127:38441", CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey });
  execFileSync("npx", ["convex", "env", "set", "ALLOW_TEST_HELPERS", "1"], { env, stdio: "ignore" });
  target = { url: PROD_URL, adminKey, name: null };
  console.log("Target: prod (test helpers on for this run)");
} else {
  const b = await startBackend({ build: false });
  target = b;
  console.log(`Target: local backend ${b.url}`);
}
const admin = new ConvexHttpClient(target.url);
admin.setAdminAuth(target.adminKey);
const logsSince = new Date().toISOString();

const clients = [];
async function player(name) {
  const p = await within("createPlayer", admin.action(api.testing.createPlayer, { name }));
  const client = new ConvexClient(target.url);
  client.setAuth(async () => p.token);
  clients.push(client);
  // Clock offset, the way the app measures it.
  let best = null;
  for (let i = 0; i < 4; i++) {
    const sent = Date.now();
    const server = await within("time.now", client.mutation(api.time.now, {}));
    const rtt = Date.now() - sent;
    if (!best || rtt < best.rtt) best = { rtt, offset: server - (sent + rtt / 2) };
  }
  const quiet = process.argv.includes("--no-presence");
  const beat = quiet ? null : setInterval(() => client.mutation(api.presence.heartbeat, { path: "/load", online: true }).catch((e) => err("heartbeat", e)), 10_000);
  const tap = quiet ? null : setInterval(() => client.mutation(api.presence.tap, { x: Math.random(), y: Math.random() * 800, path: "/load" }).catch((e) => err("tap", e)), 900 + Math.random() * 600);
  return { ...p, name, client, offset: best.offset, timers: [beat, tap].filter(Boolean) };
}

async function realtimeGame(i, deadline) {
  const a = await player(`LoadBot ${i}A`);
  const b = await player(`LoadBot ${i}B`);
  const id = await within("challenge", a.client.mutation(api.matches.challenge, { mode: "chess:realtime", opponent: b.userId }));
  await within("join", b.client.mutation(api.matches.join, { id }));
  const m = await admin.query(api.testing.getMatch, { id });
  const color = (p) => m.players.find((x) => x.userId === p.userId).color;
  await within("ready", Promise.all([a, b].map((p) => p.client.mutation(api.chess.ready, { id }))));
  let startAt = null;
  const startBy = Date.now() + 15_000;
  while (startAt === null) {
    if (Date.now() > startBy) throw new Error("timed out: waiting for start");
    startAt = (await admin.query(api.testing.getMatch, { id })).state.startAt;
    if (startAt === null) await sleep(200);
  }
  // Each side watches the game through its own subscription, like the app does.
  const views = new Map();
  const sentAt = new Map();
  const seen = new Set();
  for (const p of [a, b]) {
    p.client.onUpdate(api.chess.rtState, { id }, (rt) => {
      if (!rt) return;
      views.set(p.userId, rt);
      // A move counts as delivered the first time it shows up in the opponent's subscription.
      for (const c of rt.commands) {
        const key = `${c.color}:${c.pieceId}:${c.toX}:${c.toY}`;
        const sent = sentAt.get(key);
        if (c.color !== color(p) && sent && !seen.has(`${p.userId}:${key}:${sent}`)) {
          seen.add(`${p.userId}:${key}:${sent}`);
          stats.propagation.push(Date.now() - sent);
        }
      }
    });
  }
  await sleep(Math.max(0, startAt - (Date.now() + a.offset)) + 50);
  const play = async (p) => {
    const me = color(p);
    while (Date.now() < deadline) {
      await sleep(500 + Math.random() * 900);
      const rt = views.get(p.userId);
      if (!rt) continue;
      const tick = Math.floor((Date.now() + p.offset - startAt) / TICK_MS);
      const state = simulate(rt.commands, tick + 1, rt.snapshot ?? initialState());
      if (state.result) return;
      const mine = state.pieces.filter((x) => x.color === me && x.status === "ready");
      const moves = mine.flatMap((piece) => legalTargets(state.pieces, piece).map((to) => ({ piece, to })));
      if (!moves.length) continue;
      // Lean towards captures so games actually end.
      const captures = moves.filter(({ to }) => state.pieces.some((x) => x.color !== me && x.status !== "moving" && x.x === to[0] && x.y === to[1]));
      const { piece, to } = (captures.length && Math.random() < 0.8 ? captures : moves)[Math.floor(Math.random() * (captures.length && Math.random() < 0.8 ? captures.length : moves.length))] ?? moves[0];
      const t0 = Date.now();
      // Record before sending: the opponent can hear about the move before the mover's own reply lands.
      sentAt.set(`${me}:${piece.id}:${to[0]}:${to[1]}`, t0);
      try {
        await within("rtMove", p.client.mutation(api.chess.rtMove, { id, pieceId: piece.id, toX: to[0], toY: to[1], clientTick: tick }));
        stats.rtMove.push(Date.now() - t0);
      } catch (e) {
        if (/over/.test(e.message)) return;
        stats.rejected++;
        err("rtMove", e);
      }
    }
  };
  await Promise.all([play(a), play(b)]);
  // Wait for the ticker to settle a result, or resign so the game ends.
  const until = Date.now() + 8000;
  let final = await admin.query(api.testing.getMatch, { id });
  while (final.status === "active" && Date.now() < until) {
    await sleep(500);
    final = await admin.query(api.testing.getMatch, { id });
  }
  if (final.status === "active") {
    await a.client.mutation(api.matches.resign, { id }).catch((e) => err("resign", e));
    final = await admin.query(api.testing.getMatch, { id });
  }
  stats.finished += final.status === "finished" ? 1 : 0;
  const reason = final.result?.reason ?? final.status;
  stats.results.set(reason, (stats.results.get(reason) ?? 0) + 1);
}

async function classicGame(i, deadline) {
  const a = await player(`LoadBot C${i}A`);
  const b = await player(`LoadBot C${i}B`);
  const id = await within("challenge", a.client.mutation(api.matches.challenge, { mode: "chess:classic", opponent: b.userId }));
  await within("join", b.client.mutation(api.matches.join, { id }));
  const { Chess } = await import("chess.js");
  while (Date.now() < deadline) {
    const m = await admin.query(api.testing.getMatch, { id });
    if (m.status !== "active") break;
    const chess = new Chess(m.state.fen);
    const mover = m.players.find((p) => p.color === chess.turn()).userId === a.userId ? a : b;
    const moves = chess.moves({ verbose: true });
    const mv = moves[Math.floor(Math.random() * moves.length)];
    const t0 = Date.now();
    try {
      await within("classic move", mover.client.mutation(api.chess.move, { id, from: mv.from, to: mv.to, promotion: mv.promotion }));
      stats.classicMove.push(Date.now() - t0);
    } catch (e) {
      err("classic move", e);
    }
    await sleep(300 + Math.random() * 500);
  }
  const m = await admin.query(api.testing.getMatch, { id });
  if (m.status === "active") await a.client.mutation(api.matches.resign, { id }).catch((e) => err("resign", e));
}

const started = Date.now();
const deadline = started + SECONDS * 1000;
// Last line of defence: whatever happens, clean up and switch test helpers off.
const watchdog = setTimeout(async () => {
  console.log("WATCHDOG: run overran, cleaning up");
  try { await within("cleanup", admin.mutation(api.testing.removeTestData, {}), 30_000); } catch (e) { console.log("cleanup failed", e.message); }
  if (PROD) execFileSync("npx", ["convex", "env", "remove", "ALLOW_TEST_HELPERS"], { env, stdio: "ignore" });
  else stopBackend(target.name);
  process.exit(1);
}, (SECONDS + 120) * 1000);
try {
  console.log(`Running ${GAMES} real-time and ${CLASSIC} classic games for ${SECONDS}s (${(GAMES + CLASSIC) * 2} players)...`);
  await Promise.all([
    ...Array.from({ length: GAMES }, (_, i) => realtimeGame(i, deadline).catch((e) => err("realtime game", e))),
    ...Array.from({ length: CLASSIC }, (_, i) => classicGame(i, deadline).catch((e) => err("classic game", e))),
  ]);
} finally {
  clearTimeout(watchdog);
  await Promise.all(clients.map((c) => within("close", c.close(), 5000).catch(() => {})));
  let occ = "n/a";
  try {
    const logs = PROD
      ? execFileSync("ssh", ["kiwi", `docker logs --since ${logsSince} group53-convex-1 2>&1`]).toString()
      : execFileSync("docker", ["logs", "--since", logsSince, target.name], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    const lines = logs.split("\n").filter((l) => /Optimistic concurrency control failed|Caught occ error/.test(l));
    const byFn = new Map();
    for (const l of lines) {
      const fn = (l.match(/retrying Some\("([^"]+)"\)/) ?? l.match(/A call to "([^"]+)"/) ?? l.match(/the "(\w+)" table/) ?? [])[1] ?? "?";
      const table = (l.match(/the "(\w+)" table/) ?? [])[1] ?? "?";
      const k = `${fn} on ${table}`;
      byFn.set(k, (byFn.get(k) ?? 0) + 1);
    }
    occ = `${lines.length}${byFn.size ? ` (${[...byFn].map(([k, v]) => `${k}: ${v}`).join("; ")})` : ""}`;
  } catch {}
  const removed = await admin.mutation(api.testing.removeTestData, {}).catch((e) => (err("cleanup", e), null));
  if (PROD) execFileSync("npx", ["convex", "env", "remove", "ALLOW_TEST_HELPERS"], { env, stdio: "ignore" });
  else stopBackend(target.name);

  console.log(`\n=== Load test (${PROD ? "prod" : "local"}) ===`);
  console.log(`real-time moves:   ${stats.rtMove.length}  latency p50 ${pct(stats.rtMove, 50)}ms  p95 ${pct(stats.rtMove, 95)}ms  max ${pct(stats.rtMove, 100)}ms`);
  console.log(`reach opponent:    ${stats.propagation.length}  p50 ${pct(stats.propagation, 50)}ms  p95 ${pct(stats.propagation, 95)}ms  max ${pct(stats.propagation, 100)}ms`);
  console.log(`classic moves:     ${stats.classicMove.length}  p50 ${pct(stats.classicMove, 50)}ms  p95 ${pct(stats.classicMove, 95)}ms`);
  console.log(`real-time results: ${[...stats.results].map(([k, v]) => `${k} ${v}`).join(", ")}  (${stats.finished}/${GAMES} finished)`);
  console.log(`server conflict retries in logs: ${occ}`);
  console.log(`errors: ${stats.errors.size ? "" : "none"}`);
  for (const [k, v] of stats.errors) console.log(`  ${v}x ${k}`);
  console.log(`cleanup: ${removed ? `${removed.players} test players, ${removed.matches} games removed` : "failed"}`);
  process.exit(0);
}
