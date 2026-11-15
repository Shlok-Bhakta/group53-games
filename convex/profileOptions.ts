import { FRAME_COLOR } from "./palette";

export { FRAME_COLORS } from "./palette";

export const FRAMES = ["none", "solid", "comet", "pulse", "neon", "gold", "fire", "ice", "toxic", "holo", "rgb"] as const;
export const CUSTOM_COLOR_FRAMES: readonly Frame[] = ["solid", "comet", "pulse", "neon"];
export const EFFECTS = ["none", "foil", "crt"] as const;
export const BADGES = [
  "",
  "👑",
  "🐐",
  "🔥",
  "💀",
  "🤡",
  "🧠",
  "🎯",
  "🐍",
  "🍀",
  "🥶",
  "😈",
  "🗿",
  "🦀",
  "🫡",
  "💻",
  "🐛",
  "☕",
  "🚀",
  "🐧",
  "👾",
  "🃏",
  "🎲",
  "⚡",
] as const;
export const TAGLINE_MAX = 40;

export type Frame = (typeof FRAMES)[number];
export type Effect = (typeof EFFECTS)[number];

export const DEFAULT_PROFILE = {
  frame: "none",
  frameColor: FRAME_COLOR.green,
  glow: false,
  effect: "none",
  badge: "",
  tagline: "",
} as const;

export const isHexColor = (s: string) => /^#[0-9a-f]{6}$/i.test(s);
