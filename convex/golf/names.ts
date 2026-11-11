import type { Power } from "./engine";

// Every item's name, for the screens (src/games/golf/items.ts adds the icons) and the settings that pick
// which ones a game's boxes give.
export const POWER_NAMES: Record<Power, string> = {
  rocket: "Rocket Driver",
  ghost: "Ghost",
  magnet: "Magnet",
  brake: "Brake",
  mulligan: "Mulligan",
  bigcup: "Big cup",
  jump: "Jump",
  bouncy: "Bouncy",
  spring: "Spring Boots",
  cart: "Golf Cart",
  jumbo: "Jumbo Burger",
  smoke: "Smoke Bomb",
  laser: "Orbital Laser",
  mine: "Landmine",
  railgun: "Rail Gun",
  missile: "Rocket Launcher",
  horn: "Air Horn",
  pistol: "Dueling Pistol",
  elephant: "Elephant Gun",
  coffee: "Coffee",
  shield: "Electromagnet",
  freeze: "Freeze Bomb",
  flash: "Flash Camera",
  storm: "Thunderstorm",
  honey: "Honey",
};
