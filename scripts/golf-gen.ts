import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { generateHole } from "../convex/golf/gen";
import type { Course, Vec } from "../convex/golf/engine";
import { GOLF_MAP as P } from "./palette.mjs";

const require = createRequire(import.meta.url);
const { Resvg } = require("../og/node_modules/@resvg/resvg-js");

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const seeds = arg("seeds", "1,2,3").split(",").map(Number);
const holes = Number(arg("holes", "9"));
const terrain = Number(arg("terrain", "2")),
  style = Number(arg("style", "2")),
  hazards = Number(arg("hazards", "1"));
const out = arg("out", "e2e/.state/golf-gen");
fs.mkdirSync(out, { recursive: true });

const poly = (p: Vec[]) => p.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join("") + "Z";

function svgOf(c: Course, label: string[]) {
  const C = c.theme === "ice" ? P.ice : P.grass;
  const rough = c.surface === "rough" || c.surface === "snow";
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${c.w}" height="${c.h}" fill="${c.off === "water" ? C.water : P.void}"/>`);
  parts.push(`<path d="${c.greens.map((g) => poly(g.poly)).join("")}" fill="${rough ? C.rough : C.grass}" fill-rule="evenodd"/>`);
  for (const z of c.zones) {
    const fill =
      z.kind === "green" || z.kind === "packed"
        ? C.grass
        : z.kind === "sand" || z.kind === "snow"
          ? C.sand
          : z.kind === "water"
            ? C.water
            : z.kind === "ice"
              ? C.ice
              : z.kind === "bridge"
                ? P.bridge
                : z.kind === "boost"
                  ? P.boost
                  : z.kind === "ramp"
                    ? P.ramp
                    : z.kind === "slope"
                      ? P.slope
                      : z.kind === "mound"
                        ? (z as { strength: number }).strength > 0
                          ? P.moundUp
                          : P.moundDown
                        : z.kind === "wind"
                          ? P.wind
                          : P.unknownZone;
    parts.push(`<path d="${poly(z.poly)}" fill="${fill}"/>`);
    if ("dir" in z && (z.kind === "boost" || z.kind === "ramp" || z.kind === "slope" || z.kind === "wind")) {
      const cx = z.poly.reduce((a, p) => a + p.x, 0) / z.poly.length,
        cy = z.poly.reduce((a, p) => a + p.y, 0) / z.poly.length;
      parts.push(
        `<line x1="${cx}" y1="${cy}" x2="${cx + z.dir.x * 1.6}" y2="${cy + z.dir.y * 1.6}" stroke="${P.arrow}" stroke-width="0.3"/>`,
      );
    }
  }
  for (const k of [c.cup]) parts.push(`<circle cx="${k.x}" cy="${k.y}" r="3.2" fill="${C.putting}" opacity="0.6"/>`);
  for (const g of c.greens)
    if (g.rim !== false) parts.push(`<path d="${poly(g.poly)}" fill="none" stroke="${C.wall}" stroke-width="0.5"/>`);
  for (const w of c.walls)
    parts.push(
      `<path d="${w.pts.map((q, i) => `${i ? "L" : "M"}${q.x},${q.y}`).join("")}" fill="none" stroke="${C.wall}" stroke-width="${w.w}" stroke-linecap="round"/>`,
    );
  for (const b of c.bumpers)
    parts.push(`<circle cx="${b.at.x}" cy="${b.at.y}" r="${b.r}" fill="${C.bumper}" stroke="${C.wall}" stroke-width="0.15"/>`);
  for (const m of c.movers) {
    if (m.kind === "spinner")
      parts.push(
        `<circle cx="${m.at.x}" cy="${m.at.y}" r="${m.L}" fill="none" stroke="${P.mover}" stroke-width="0.25" stroke-dasharray="0.6 0.4"/>`,
        `<line x1="${m.at.x - m.L}" y1="${m.at.y}" x2="${m.at.x + m.L}" y2="${m.at.y}" stroke="${P.mover}" stroke-width="${m.w}"/>`,
      );
    if (m.kind === "slider")
      parts.push(
        `<line x1="${m.a.x}" y1="${m.a.y}" x2="${m.b.x}" y2="${m.b.y}" stroke="${P.mover}" stroke-width="0.2" stroke-dasharray="0.5 0.4"/>`,
        `<rect x="${m.a.x - m.size.x / 2}" y="${m.a.y - m.size.y / 2}" width="${m.size.x}" height="${m.size.y}" fill="${P.crate}"/>`,
      );
  }
  for (const m of c.mines ?? [])
    parts.push(`<circle cx="${m.x}" cy="${m.y}" r="0.5" fill="${P.mine}" stroke="${P.mineRim}" stroke-width="0.15"/>`);
  for (const b of c.boxes)
    parts.push(
      `<rect x="${b.x - 0.6}" y="${b.y - 0.6}" width="1.2" height="1.2" fill="${P.box}" stroke="${P.boxRim}" stroke-width="0.12"/>`,
    );
  for (const t of c.tees ?? []) parts.push(`<circle cx="${t.x}" cy="${t.y}" r="0.25" fill="${P.spareTee}"/>`);
  parts.push(`<circle cx="${c.tee.x}" cy="${c.tee.y}" r="0.45" fill="${P.ball}"/>`);
  parts.push(
    `<circle cx="${c.cup.x}" cy="${c.cup.y}" r="0.72" fill="${P.cup}"/>`,
    `<line x1="${c.cup.x}" y1="${c.cup.y}" x2="${c.cup.x}" y2="${c.cup.y - 3}" stroke="${P.ball}" stroke-width="0.15"/>`,
    `<path d="M${c.cup.x},${c.cup.y - 3}l1.6,0.5l-1.6,0.5z" fill="${P.flag}"/>`,
  );
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
    const label = [
      `${n + 1}. ${c.name}`,
      `par ${c.par}, ${kept.replace("kept ", "")}`,
      `${((performance.now() - t0) / 1000).toFixed(1)}s, ${log.length - 1} thrown out`,
    ];
    cells.push({ c, label });
    all.push({ seed, n: n + 1, kept, rejected: log.filter((l) => !l.startsWith("kept")), course: c });
    console.log(`seed ${seed} hole ${n + 1}: ${label.join(" | ")}`);
  }
  const scale = 9,
    pad = 8,
    top = 50;
  const W = cells.reduce((a, x) => a + x.c.w * scale + pad, pad),
    H = Math.max(...cells.map((x) => x.c.h * scale)) + top + pad;
  let x = pad;
  const g: string[] = [];
  for (const { c, label } of cells) {
    const { body } = svgOf(c, label);
    g.push(`<g transform="translate(${x},${top}) scale(${scale})">${body}</g>`);
    label.forEach((l, i) =>
      g.push(
        `<text x="${x}" y="${14 + i * 15}" font-family="sans-serif" font-size="${i ? 11 : 13}" fill="${i ? P.label : P.title}">${l.replace(/&/g, "&amp;")}</text>`,
      ),
    );
    x += c.w * scale + pad;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${P.sheet}"/>${g.join("")}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: true } }).render().asPng();
  fs.writeFileSync(path.join(out, `seed-${seed}-t${terrain}-s${style}-h${hazards}.png`), png);
}
fs.writeFileSync(path.join(out, `holes-t${terrain}-s${style}-h${hazards}-${seeds.join("_")}.json`), JSON.stringify(all));
console.log(`wrote ${out}`);
