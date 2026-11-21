export type Card = string;
export const COLORS = ["r", "y", "g", "b"] as const;
export type Color = (typeof COLORS)[number];
export const WILD = "w";

export type Face =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "S"
  | "R"
  | "D2"
  | "D4"
  | "SA"
  | "DA"
  | "W"
  | "W4"
  | "WR4"
  | "W6"
  | "W10"
  | "WC";

export type DeckKind = "classic" | "nomercy";

export const colorOf = (c: Card) => c[0];
export const faceOf = (c: Card) => c.slice(1) as Face;
export const isWild = (c: Card) => c[0] === WILD;
export const isColor = (x: string): x is Color => (COLORS as readonly string[]).includes(x);
export const isNumber = (c: Card) => /^[0-9]$/.test(faceOf(c));

const DRAWS: Partial<Record<Face, number>> = { D2: 2, D4: 4, W4: 4, WR4: 4, W6: 6, W10: 10 };
export const drawOf = (c: Card) => DRAWS[faceOf(c)] ?? 0;

const NUMBERS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

type Recipe = { perColor: [Face, number][]; wilds: [Face, number][] };
const RECIPES: Record<DeckKind, Recipe> = {
  classic: {
    perColor: [["0", 1], ...NUMBERS.slice(1).map((n): [Face, number] => [n, 2]), ["S", 2], ["R", 2], ["D2", 2]],
    wilds: [
      ["W", 4],
      ["W4", 4],
    ],
  },
  nomercy: {
    perColor: [...NUMBERS.map((n): [Face, number] => [n, 2]), ["S", 3], ["SA", 2], ["R", 3], ["D2", 3], ["D4", 2], ["DA", 3]],
    wilds: [
      ["WR4", 8],
      ["W6", 4],
      ["W10", 4],
      ["WC", 8],
    ],
  },
};

export function deckOf(kind: DeckKind, decks = 1): Card[] {
  const r = RECIPES[kind];
  const one: Card[] = [
    ...COLORS.flatMap((c) => r.perColor.flatMap(([f, n]) => Array<Card>(n).fill(c + f))),
    ...r.wilds.flatMap(([f, n]) => Array<Card>(n).fill(WILD + f)),
  ];
  return Array.from({ length: Math.max(1, decks) }, () => one).flat();
}

export const FACES_IN: Record<DeckKind, Face[]> = {
  classic: [...NUMBERS, "S", "R", "D2", "W", "W4"],
  nomercy: [...NUMBERS, "S", "SA", "R", "D2", "D4", "DA", "WR4", "W6", "W10", "WC"],
};

export function shuffle<T>(xs: T[], random: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pointsOf(c: Card) {
  if (isWild(c)) return 50;
  if (isNumber(c)) return Number(faceOf(c));
  return 20;
}

export const COLOR_NAME: Record<string, string> = { r: "Red", y: "Yellow", g: "Green", b: "Blue", w: "Wild" };

export const FACE_NAME: Record<Face, string> = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  S: "Skip",
  R: "Reverse",
  D2: "Draw 2",
  D4: "Draw 4",
  SA: "Skip Everyone",
  DA: "Discard All",
  W: "Wild",
  W4: "Wild Draw 4",
  WR4: "Wild Reverse Draw 4",
  W6: "Wild Draw 6",
  W10: "Wild Draw 10",
  WC: "Color Roulette",
};

export const cardName = (c: Card) => (isWild(c) ? FACE_NAME[faceOf(c)] : `${COLOR_NAME[colorOf(c)]} ${FACE_NAME[faceOf(c)]}`);

const ORDER = "rygbw";
export function sortHand(cards: Card[], kind: DeckKind): Card[] {
  const faces = FACES_IN[kind];
  return [...cards].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]) || faces.indexOf(faceOf(a)) - faces.indexOf(faceOf(b)));
}
