// Recolors the white Cburnett pieces for four-player chess: node scripts/gen-four-pieces.mjs
// Output: public/pieces/four/<color><Kind>.svg (red, blue, yellow, green, and grey for eliminated armies).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const COLORS = { red: "#e0503f", blue: "#3f7be0", yellow: "#e8b928", green: "#3faa5a", dead: "#9aa0a6" };
mkdirSync("public/pieces/four", { recursive: true });
for (const kind of ["K", "Q", "R", "B", "N", "P"]) {
  const svg = readFileSync(`public/pieces/w${kind}.svg`, "utf8");
  for (const [name, hex] of Object.entries(COLORS)) {
    const out = svg.replace(/fill:#ffffff/gi, `fill:${hex}`).replace(/fill="#fff(fff)?"/gi, `fill="${hex}"`);
    writeFileSync(`public/pieces/four/${name}${kind}.svg`, out);
  }
}
console.log("ok");
