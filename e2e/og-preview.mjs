// Renders link previews against a throwaway backend with a real game in progress.
// node e2e/og-preview.mjs  ->  e2e/.state/og-match.png and e2e/.state/og-chess.png
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { startBackend, stopBackend } from "./backend.mjs";

const b = await startBackend();
const admin = new ConvexHttpClient(b.url);
admin.setAdminAuth(b.adminKey);
const player = async (name, image) => {
  const p = await admin.action(anyApi.testing.createPlayer, { name, image });
  const client = new ConvexHttpClient(b.url);
  client.setAuth(p.token);
  return { ...p, client };
};
const a = await player("WashableBowl700", "https://cdn.discordapp.com/avatars/719077732042014761/44639fc5bce7c79f99de5625f7fed7a8.png?size=256");
const c = await player("chrisis14", "https://cdn.discordapp.com/avatars/492431153375084547/f69aa29f75cacbf294c0d465c351d701.png?size=256");
const id = await a.client.mutation(anyApi.matches.queue, { mode: "chess:classic" });
await c.client.mutation(anyApi.matches.queue, { mode: "chess:classic" });
const m = await admin.query(anyApi.testing.getMatch, { id });
const white = m.players.find((p) => p.color === "w").userId === a.userId ? a : c;
const black = white === a ? c : a;
for (const [p, from, to] of [[white, "e2", "e4"], [black, "e7", "e5"], [white, "g1", "f3"], [black, "b8", "c6"], [white, "f1", "c4"]]) {
  await p.client.mutation(anyApi.chess.move, { id, from, to });
}

// A four-player game a few moves in.
const s4 = await player("samwise");
const a4 = await player("alex_dev");
const four = [a, c, s4, a4];
const fid = await admin.action(anyApi.testing.startFour, { mode: "chess:four", players: four.map((p) => p.userId) });
const sq = (s) => ({ x: s.charCodeAt(0) - 97, y: Number(s.slice(1)) - 1 });
for (const [i, from, to] of [[0, "e2", "e4"], [1, "b5", "d5"], [2, "f13", "f11"], [3, "m10", "k10"]]) {
  const f = sq(from);
  const t = sq(to);
  await four[i].client.mutation(anyApi.chess.fourMove, { id: fid, fromX: f.x, fromY: f.y, toX: t.x, toY: t.y });
}

mkdirSync("e2e/.state", { recursive: true });
writeFileSync("e2e/.state/admin_key", b.adminKey);
const pieces = spawn("python3", ["-m", "http.server", "8789", "-d", "public"], { stdio: "ignore" });
const og = spawn("node", ["og/server.mjs"], {
  env: { ...process.env, CONVEX_URL: b.url, ADMIN_KEY_FILE: "e2e/.state/admin_key", PORT: "8788", PIECES_URL: "http://127.0.0.1:8789/pieces" },
  stdio: "inherit",
});
await new Promise((r) => setTimeout(r, 1500));
try {
  const html = await (await fetch(`http://127.0.0.1:8788/chess/${id}`)).text();
  console.log(html.split("\n").filter((l) => /og:(title|description)"/.test(l)).join("\n"));
  const img = html.match(/og\/match\/[a-z0-9]+\.png\?v=[a-z0-9]+/)[0];
  writeFileSync("e2e/.state/og-match.png", Buffer.from(await (await fetch(`http://127.0.0.1:8788/${img}`)).arrayBuffer()));
  const html4 = await (await fetch(`http://127.0.0.1:8788/chess/${fid}`)).text();
  console.log(html4.split("\n").filter((l) => /og:(title|description)"/.test(l)).join("\n"));
  const img4 = html4.match(/og\/match\/[a-z0-9]+\.png\?v=[a-z0-9]+/)[0];
  writeFileSync("e2e/.state/og-four.png", Buffer.from(await (await fetch(`http://127.0.0.1:8788/${img4}`)).arrayBuffer()));
  writeFileSync("e2e/.state/og-chess.png", Buffer.from(await (await fetch("http://127.0.0.1:8788/og/image/chess.png")).arrayBuffer()));
} finally {
  og.kill();
  pieces.kill();
  stopBackend(b.name);
}
