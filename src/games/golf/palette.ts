export const PALETTE = {
  grass: "#5c9a4b",
  mow: "#67a455",
  putting: "#4f8f40",
  rail: "#ece4d0",
  railLine: "#d6ccb3",
  bumper: "#b5533f",
  bumperRing: "#ece4d0",
  cup: "#1d2a1a",
  flag: "#c4473a",
  box: "#d4aa44",
  boxInk: "#5a4212",
  pad: "#c9853f",
  ramp: "#5f819c",
  sand: "#d8c9a8",
  rough: "#4a7d3c",
  mine: "#3a3934",
  mineLight: "#e0503f",
  ball: "#fbf9f3",
  ballShade: "#e1ddd2",
  ink: "#fbf9f3",
  water: "#6aa3b1",
  waterLight: "#86b7c2",
  foam: "#dfe9e3",
  wood: "#b48a5a",
  woodLine: "#977145",
  portal: "#8c80b4",
  ice: "#dcebf0",
  iceLine: "#b9d5df",
  honey: "#d99a2b",
  honeyLight: "#efc56a",
  cloud: "#474d55",
  shield: "#8cc4e3",
  stun: "#f3d35b",
  steam: "#efe6d6",
} as const;

export const ICE_PALETTE: CoursePalette = {
  ...PALETTE,
  grass: "#86aec2",
  mow: "#91b7c9",
  putting: "#769fb5",
  rail: "#f0f5f7",
  railLine: "#cbdbe3",
  bumper: "#bd5645",
  cup: "#1d2d38",
  sand: "#eef4f7",
  rough: "#dfe9ee",
  ramp: "#47677f",
  water: "#3b6a84",
  waterLight: "#5789a2",
  foam: "#d4e6ed",
  wood: "#6d97ad",
  woodLine: "#3f667e",
  ice: "#c7e0ea",
  iceLine: "#a4c9d9",
};
export type CoursePalette = Record<keyof typeof PALETTE, string>;

export const VOID_FALLBACK = { bg: "#1c2620", dot: "rgba(255,255,255,0.08)" };

export const FX = {
  confettiGreen: "#8cbf6a",
  smokeFrom: "rgba(239,230,214,0)",
  smokeTo: "rgba(239,230,214,0.6)",
  flameLayers: [
    ["#d9602a", 1, 0.95],
    ["#f19a35", 0.68, 0.72],
    ["#fff0b8", 0.36, 0.46],
  ] as [string, number, number][],
  rocket: "#f19a35",
  ember: "#fff0b8",
  iceCube: "rgba(214,236,244,0.55)",
  iceCubeEdge: "#bfe3f0",
  iceGlint: "rgba(255,255,255,0.8)",
  shieldBubble: "rgba(140,196,227,0.18)",
  portalInside: "rgba(20,16,40,0.35)",
  airShadow: "rgba(0,0,0,0.22)",
  teeMark: "rgba(0,0,0,0.1)",
  mineCore: "#6e2a20",
  rocketTrail: (alpha: number) => `rgba(241,154,53,${alpha})`,
  ballTrail: (alpha: number) => `rgba(251,249,243,${alpha})`,
  aimGuide: "rgba(251,249,243,0.45)",
  blast: "#fff2c4",
  lightning: "#fbf6d8",
  flash: "#ffffff",
  chill: "#cfeaf4",
  frost: "#cfe9f2",
  freezeSpark: "#dff1f7",
  rocketSmoke: "#9c9a92",
};

export const LAST_BALL_COLOR = "#f4f1e8";

export const ART = {
  nextShot: "rgba(251,249,243,0.85)",
  streak: "rgba(251,249,243,0.35)",
};

export const OVERLAY = {
  flash: "#ffffff",
  title: "#ffffff",
  titleShadow: "0 2px 12px rgb(0 0 0 / 0.55)",
};
