// Shared by the server (validation) and the client (pickers and rendering).

// Frames wrap the player card and the avatar ring. "Custom" frames take frameColor.
export const FRAMES = ["none", "solid", "comet", "pulse", "neon", "gold", "fire", "ice", "toxic", "holo", "rgb"] as const;
export const CUSTOM_COLOR_FRAMES: readonly Frame[] = ["solid", "comet", "pulse", "neon"];
export const EFFECTS = ["none", "foil", "crt"] as const;
export const BADGES = [
  "", "👑", "🐐", "🔥", "💀", "🤡", "🧠", "🎯", "🐍", "🍀", "🥶", "😈",
  "🗿", "🦀", "🫡", "💻", "🐛", "☕", "🚀", "🐧", "👾", "🃏", "🎲", "⚡",
] as const;
export const FRAME_COLORS = ["#f8fafc", "#5fae57", "#e3b341", "#e5484d", "#3b82f6", "#a855f7", "#ec4899", "#22d3ee"] as const;
export const TAGLINE_MAX = 40;

export type Frame = (typeof FRAMES)[number];
export type Effect = (typeof EFFECTS)[number];

export const DEFAULT_PROFILE = { frame: "none", frameColor: "#5fae57", glow: false, effect: "none", badge: "", tagline: "" } as const;

export const isHexColor = (s: string) => /^#[0-9a-f]{6}$/i.test(s);
