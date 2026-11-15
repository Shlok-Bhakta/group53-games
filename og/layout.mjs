import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { AVATAR, BRAND, CARD, RINGS, TILE, TILE_EDGE, TILE_INK, TILE_INK_DEFAULT } from "./palette.mjs";

const require = createRequire(import.meta.url);

export const WIDTH = 1200;
export const HEIGHT = 630;
export const BOARD_SIDE = 512;
const FETCH_TIMEOUT_MS = 3000;

const font = (weight) => readFileSync(require.resolve(`@fontsource/rubik/files/rubik-latin-${weight}-normal.woff`));
const FONTS = [
  { name: "Rubik", data: font(500), weight: 500, style: "normal" },
  { name: "Rubik", data: font(800), weight: 800, style: "normal" },
];

export const h = (type, style, ...children) => ({
  type,
  props: { style: { display: "flex", boxSizing: "border-box", ...style }, children: children.flat() },
});

export const img = (src, width, height, style) => ({ type: "img", props: { src, width, height, ...(style ? { style } : {}) } });

export const svgDataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

export const listNames = (names) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function tiles(word, states, size) {
  return h(
    "div",
    { gap: size * 0.12 },
    [...word].map((ch, i) => {
      const state = states[i] ?? "blank";
      return h(
        "div",
        {
          width: size,
          height: size,
          borderRadius: size * 0.17,
          background: TILE[state],
          color: TILE_INK[state] ?? TILE_INK_DEFAULT,
          fontSize: size * 0.56,
          fontWeight: 800,
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `inset 0 -${size * 0.07}px 0 ${TILE_EDGE}`,
          transform: state === "hit" ? `rotate(-9deg) translateY(${size * 0.06}px)` : undefined,
        },
        ch,
      );
    }),
  );
}

const FRAMES_IN_THEIR_OWN_COLOR = ["solid", "comet", "pulse", "neon"];

export function avatar(p, size, image) {
  const ring = p.frame === "none" ? null : ((FRAMES_IN_THEIR_OWN_COLOR.includes(p.frame) ? p.frameColor : RINGS[p.frame]) ?? null);
  const pad = ring ? size * 0.06 : 0;
  const face = image
    ? img(image, size - pad * 2 - size * 0.07, size - pad * 2 - size * 0.07, { borderRadius: 9999 })
    : h(
        "div",
        {
          width: "100%",
          height: "100%",
          borderRadius: 9999,
          background: AVATAR.fallback,
          color: AVATAR.initial,
          fontSize: size * 0.42,
          fontWeight: 800,
          alignItems: "center",
          justifyContent: "center",
        },
        p.name.slice(0, 1).toUpperCase(),
      );
  return h(
    "div",
    { position: "relative", width: size, height: size },
    h(
      "div",
      {
        width: size,
        height: size,
        borderRadius: 9999,
        padding: pad,
        background: ring ?? "transparent",
        backgroundImage: ring?.startsWith("linear") ? ring : undefined,
      },
      h(
        "div",
        {
          width: "100%",
          height: "100%",
          borderRadius: 9999,
          padding: size * 0.035,
          background: AVATAR.inner,
          alignItems: "center",
          justifyContent: "center",
        },
        face,
      ),
    ),
    p.badge ? h("div", { position: "absolute", right: -size * 0.06, bottom: -size * 0.06, fontSize: size * 0.36 }, p.badge) : [],
  );
}

export const CREW_SHOWN = 7;

export function crewRow(crew, images, size = 92) {
  const shown = crew.slice(0, CREW_SHOWN);
  return h(
    "div",
    { alignItems: "center" },
    shown.map((p, i) => h("div", { marginLeft: i === 0 ? 0 : -size * 0.18 }, avatar(p, size, images[i]))),
    crew.length > shown.length
      ? h("div", { marginLeft: 16, color: AVATAR.initial, fontSize: 34, fontWeight: 800 }, `+${crew.length - shown.length}`)
      : [],
  );
}

export function frame(...children) {
  return h(
    "div",
    {
      width: WIDTH,
      height: HEIGHT,
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "56px 64px",
      backgroundImage: CARD.background,
      color: CARD.text,
      fontFamily: "Rubik",
    },
    h(
      "div",
      { alignItems: "center", gap: 18 },
      tiles("53", ["green", "yellow"], 58),
      h("div", { fontSize: 40, fontWeight: 800 }, "Group 53 Games"),
    ),
    ...children,
  );
}

export const gameCard =
  ({ word, states, tileSize, blurb, blurbWidth = 940, cta = "Tap to play" }) =>
  (crew, images) =>
    frame(
      h(
        "div",
        { flexDirection: "column", gap: 28 },
        tiles(word, states, tileSize),
        h("div", { fontSize: 40, fontWeight: 500, color: CARD.blurb, maxWidth: blurbWidth, lineHeight: 1.25 }, blurb),
      ),
      h(
        "div",
        { alignItems: "center", justifyContent: "space-between" },
        crewRow(crew, images, 84),
        h("div", { color: BRAND, fontSize: 34, fontWeight: 800 }, cta),
      ),
    );

export async function fetchImage(url) {
  if (!url) return null;
  try {
    // platform: satori can't decode GIFs, so Discord's CDN is asked for a PNG and it's inlined.
    const res = await fetch(url.replace(/\.gif(\?|$)/, ".png$1"), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/png";
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function fetchSvg(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  return res.ok ? `data:image/svg+xml;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}` : undefined;
}

async function twemoji(code, segment) {
  if (code !== "emoji") return undefined;
  const points = [...segment]
    .map((c) => c.codePointAt(0).toString(16))
    .filter((c) => c !== "fe0f")
    .join("-");
  try {
    return await fetchSvg(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/${points}.svg`);
  } catch {
    return undefined;
  }
}

export async function renderPng(tree) {
  const svg = await satori(tree, { width: WIDTH, height: HEIGHT, fonts: FONTS, loadAdditionalAsset: twemoji });
  return new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng();
}
