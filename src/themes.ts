export const PALETTES = [
  { id: "felt", name: "Felt", note: "Poker night" },
  { id: "catppuccin", name: "Catppuccin", note: "Latte / Mocha" },
  { id: "gruvbox", name: "Gruvbox", note: "Light / Dark" },
  { id: "nord", name: "Nord", note: "Snow Storm / Polar Night" },
  { id: "tokyonight", name: "Tokyo Night", note: "Day / Night" },
  { id: "dracula", name: "Dracula", note: "Alucard / Dracula" },
  { id: "rosepine", name: "Rosé Pine", note: "Dawn / Main" },
  { id: "slate", name: "Slate", note: "Plain and sharp" },
  { id: "varsity", name: "Varsity", note: "Oxblood and gold" },
  { id: "wordle", name: "Wordle", note: "The original" },
] as const;

export const FONTS = [
  { id: "oxanium", name: "Oxanium" },
  { id: "rubik", name: "Rubik" },
  { id: "lexend", name: "Lexend" },
  { id: "mono", name: "JetBrains Mono" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];
export type FontId = (typeof FONTS)[number]["id"];
