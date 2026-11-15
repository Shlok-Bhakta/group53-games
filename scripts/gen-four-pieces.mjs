import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { FOUR_PLAYER_PIECES } from "./palette.mjs";

const WHITE_FILL = /fill:#ffffff/gi;
const WHITE_FILL_ATTRIBUTE = /fill="#fff(fff)?"/gi;
mkdirSync("public/pieces/four", { recursive: true });
for (const kind of ["K", "Q", "R", "B", "N", "P"]) {
  const svg = readFileSync(`public/pieces/w${kind}.svg`, "utf8");
  for (const [name, color] of Object.entries(FOUR_PLAYER_PIECES)) {
    const out = svg.replace(WHITE_FILL, `fill:${color}`).replace(WHITE_FILL_ATTRIBUTE, `fill="${color}"`);
    writeFileSync(`public/pieces/four/${name}${kind}.svg`, out);
  }
}
console.log("ok");
