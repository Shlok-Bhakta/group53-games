// Draws generated golf holes, for looking at the generator's work. Run with bun:
//   bun scripts/golf-gen.ts [--seeds 1,2,3] [--holes 9] [--terrain 0|1|2] [--style 0|1|2] [--hazards 0|1|2] [--out dir]
// Writes one PNG per seed (its holes side by side, each with its name, par, shape and attempts) and a
// holes.json with every hole, to e2e/.state/golf-gen by default. The colors are the game's; the drawing's
// a plain map, not the game's renderer.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { generateHole } from "../convex/golf/gen";
import type { Course, Vec } from "../convex/golf/engine";

const require = createRequire(import.meta.url);
const { Resvg } = require("../og/node_modules/@resvg/resvg-js");

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const seeds = arg("seeds", "1,2,3").split(",").map(Number);
const holes = Number(arg("holes", "9"));
const terrain = Number(arg("terrain", "2")), style = Number(arg("style", "2")), hazards = Number(arg("hazards", "1"));
const out = arg("out", "e2e/.state/golf-gen");
fs.mkdirSync(out, { recursive: true });

const ICE = { grass: "#86aec2", rough: "#dfe9ee", putting: "#769fb5", sand: "#eef4f7", water: "#3b6a84", ice: "#c7e0ea", wall: "#f0f5f7", bumper: "#bd5645" };
const GRASS = { grass: "#5c9a4b", rough: "#4a7d3c", putting: "#4f8f40", sand: "#d8c9a8", water: "#6aa3b1", ice: "#dcebf0", wall: "#ece4d0", bumper: "#b5533f" };
const poly = (p: Vec[]) => p.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join("") + "Z";

function svgOf(c: Course, label: string[]) {
  const C = c.theme === "ice" ? ICE : GRASS;
  const rough = c.surface === "rough" || c.surface === "snow";
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${c.w}" height="${c.h}" fill="${c.off === "water" ? C.water : "#1b1d22"}"/>`);
  parts.push(`<path d="${c.greens.map((g) => poly(g.poly)).join("")}" fill="${rough ? C.rough : C.grass}" fill-rule="evenodd"/>`);
  for (const z of c.zones) {
    const fill =
      z.kind === "green" || z.kind === "packed" ? C.grass
      : z.kind === "sand" || z.kind === "snow" ? C.sand
      : z.kind === "water" ? C.water
      : z.kind === "ice" ? C.ice
      : z.kind === "bridge" ? "#b48a5a"
      : z.kind === "boost" ? "#c9853f"
      : z.kind === "ramp" ? "#5f819c"
      : z.kind === "slope" ? "rgba(255,255,255,0.18)"
      : z.kind === "mound" ? ((z as { strength: number }).strength > 0 ? "rgba(255,255,200,0.22)" : "rgba(0,0,60,0.22)")
      : z.kind === "wind" ? "rgba(255,255,255,0.12)"
      : "rgba(255,0,255,0.4)";
    parts.push(`<path d="${poly(z.poly)}" fill="${fill}"/>`);
    if ("dir" in z && (z.kind === "boost" || z.kind === "ramp" || z.kind === "slope" || z.kind === "wind")) {
      const cx = z.poly.reduce((a, p) => a + p.x, 0) / z.poly.length, cy = z.poly.reduce((a, p) => a + p.y, 0) / z.poly.length;
      parts.push(`<line x1="${cx}" y1="${cy}" x2="${cx + z.dir.x * 1.6}" y2="${cy + z.dir.y * 1.6}" stroke="white" stroke-width="0.3"/>`);
    }
  }
  for (const k of [c.cup]) parts.push(`<circle cx="${k.x}" cy="${k.y}" r="3.2" fill="${C.putting}" opacity="0.6"/>`);
  for (const g of c.greens) if (g.rim !== false) parts.push(`<path d="${poly(g.poly)}" fill="none" stroke="${C.wall}" stroke-width="0.5"/>`);
  for (const w of c.walls) parts.push(`<path d="${w.pts.map((q, i) => `${i ? "L" : "M"}${q.x},${q.y}`).join("")}" fill="none" stroke="${C.wall}" stroke-width="${w.w}" stroke-linecap="round"/>`);
  for (const b of c.bumpers) parts.push(`<circle cx="${b.at.x}" cy="${b.at.y}" r="${b.r}" fill="${C.bumper}" stroke="${C.wall}" stroke-width="0.15"/>`);
  for (const m of c.movers) {
    if (m.kind === "spinner") parts.push(`<circle cx="${m.at.x}" cy="${m.at.y}" r="${m.L}" fill="none" stroke="#f3d35b" stroke-width="0.25" stroke-dasharray="0.6 0.4"/>`, `<line x1="${m.at.x - m.L}" y1="${m.at.y}" x2="${m.at.x + m.L}" y2="${m.at.y}" stroke="#f3d35b" stroke-width="${m.w}"/>`);
    if (m.kind === "slider") parts.push(`<line x1="${m.a.x}" y1="${m.a.y}" x2="${m.b.x}" y2="${m.b.y}" stroke="#f3d35b" stroke-width="0.2" stroke-dasharray="0.5 0.4"/>`, `<rect x="${m.a.x - m.size.x / 2}" y="${m.a.y - m.size.y / 2}" width="${m.size.x}" height="${m.size.y}" fill="#8a6a3f"/>`);
  }
  for (const m of c.mines ?? []) parts.push(`<circle cx="${m.x}" cy="${m.y}" r="0.5" fill="#3a3934" stroke="#e0503f" stroke-width="0.15"/>`);
  for (const b of c.boxes) parts.push(`<rect x="${b.x - 0.6}" y="${b.y - 0.6}" width="1.2" height="1.2" fill="#d4aa44" stroke="#5a4212" stroke-width="0.12"/>`);
  for (const t of c.tees ?? []) parts.push(`<circle cx="${t.x}" cy="${t.y}" r="0.25" fill="rgba(255,255,255,0.5)"/>`);
  parts.push(`<circle cx="${c.tee.x}" cy="${c.tee.y}" r="0.45" fill="#fbf9f3"/>`);
  parts.push(`<circle cx="${c.cup.x}" cy="${c.cup.y}" r="0.72" fill="#1d2a1a"/>`, `<line x1="${c.cup.x}" y1="${c.cup.y}" x2="${c.cup.x}" y2="${c.cup.y - 3}" stroke="#fbf9f3" stroke-width="0.15"/>`, `<path d="M${c.cup.x},${c.cup.y - 3}l1.6,0.5l-1.6,0.5z" fill="#c4473a"/>`);
  return { body: parts.join(""), label };
}

const all: Record<string, unknown>[] = [];
for (const seed of seeds) {
  const cells: { c: Course; label: string[] }[] = [];
  for (let n = 0; n < holes; n++) {
    const log: string[] = [];
    const t0 = performance.now();
    const c = generateHole({ seed, n, terrain, style, hazards }, (m) => log.push(m));
    const kept = log.find((l) => l.startsWith("kept")) ?? "fallback";
    const label = [`${n + 1}. ${c.name}`, `par ${c.par}, ${kept.replace("kept ", "")}`, `${((performance.now() - t0) / 1000).toFixed(1)}s, ${log.length - 1} thrown out`];
    cells.push({ c, label });
    all.push({ seed, n: n + 1, kept, rejected: log.filter((l) => !l.startsWith("kept")), course: c });
    console.log(`seed ${seed} hole ${n + 1}: ${label.join(" | ")}`);
  }
  // Every hole at the same scale, side by side.
  const S = 9, pad = 8, top = 50;
  const W = cells.reduce((a, x) => a + x.c.w * S + pad, pad), H = Math.max(...cells.map((x) => x.c.h * S)) + top + pad;
  let x = pad;
  const g: string[] = [];
  for (const { c, label } of cells) {
    const { body } = svgOf(c, label);
    g.push(`<g transform="translate(${x},${top}) scale(${S})">${body}</g>`);
    label.forEach((l, i) => g.push(`<text x="${x}" y="${14 + i * 15}" font-family="sans-serif" font-size="${i ? 11 : 13}" fill="${i ? "#aab" : "#fff"}">${l.replace(/&/g, "&amp;")}</text>`));
    x += c.w * S + pad;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#0e0f12"/>${g.join("")}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: true } }).render().asPng();
  fs.writeFileSync(path.join(out, `seed-${seed}-t${terrain}-s${style}-h${hazards}.png`), png);
}
fs.writeFileSync(path.join(out, `holes-t${terrain}-s${style}-h${hazards}-${seeds.join("_")}.json`), JSON.stringify(all));
console.log(`wrote ${out}`);
