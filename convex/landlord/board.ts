// The board: forty squares round a square, the standard property-trading layout, with every price and rent of
// the classic US board (2008 and later: $200 income tax, $100 luxury tax). Names are our own and live only
// here, so the board can be renamed in one place. Shared by the server and phones.

export type Group = "brown" | "sky" | "pink" | "orange" | "red" | "yellow" | "green" | "navy";

// `rent` for a street: unimproved, 1 to 4 houses, a hotel.
export type Square =
  | { kind: "go" | "jail" | "parking" | "gotojail"; name: string }
  | { kind: "street"; name: string; group: Group; price: number; house: number; rent: readonly [number, number, number, number, number, number] }
  | { kind: "rail" | "util"; name: string; price: number }
  | { kind: "tax"; name: string; amount: number }
  | { kind: "chance" | "chest"; name: string };

const street = (name: string, group: Group, price: number, house: number, ...rent: [number, number, number, number, number, number]): Square => ({
  kind: "street",
  name,
  group,
  price,
  house,
  rent,
});
const rail = (name: string): Square => ({ kind: "rail", name, price: 200 });
const util = (name: string): Square => ({ kind: "util", name, price: 150 });
const chance: Square = { kind: "chance", name: "Fortune" };
const chest: Square = { kind: "chest", name: "Treasury" };

export const BOARD: readonly Square[] = [
  { kind: "go", name: "Start" },
  street("Cinder Lane", "brown", 60, 50, 2, 10, 30, 90, 160, 250),
  chest,
  street("Tanner Row", "brown", 60, 50, 4, 20, 60, 180, 320, 450),
  { kind: "tax", name: "Income Tax", amount: 200 },
  rail("Northgate Station"),
  street("Harbor Walk", "sky", 100, 50, 6, 30, 90, 270, 400, 550),
  chance,
  street("Pier Street", "sky", 100, 50, 6, 30, 90, 270, 400, 550),
  street("Lighthouse Road", "sky", 120, 50, 8, 40, 100, 300, 450, 600),
  { kind: "jail", name: "Jail" },
  street("Rose Court", "pink", 140, 100, 10, 50, 150, 450, 625, 750),
  util("Power Plant"),
  street("Orchard Way", "pink", 140, 100, 10, 50, 150, 450, 625, 750),
  street("Blossom Avenue", "pink", 160, 100, 12, 60, 180, 500, 700, 900),
  rail("Eastgate Station"),
  street("Copper Street", "orange", 180, 100, 14, 70, 200, 550, 750, 950),
  chest,
  street("Foundry Road", "orange", 180, 100, 14, 70, 200, 550, 750, 950),
  street("Kiln Avenue", "orange", 200, 100, 16, 80, 220, 600, 800, 1000),
  { kind: "parking", name: "Rest Stop" },
  street("Market Square", "red", 220, 150, 18, 90, 250, 700, 875, 1050),
  chance,
  street("Guild Street", "red", 220, 150, 18, 90, 250, 700, 875, 1050),
  street("Crown Avenue", "red", 240, 150, 20, 100, 300, 750, 925, 1100),
  rail("Southgate Station"),
  street("Saffron Street", "yellow", 260, 150, 22, 110, 330, 800, 975, 1150),
  street("Amber Gardens", "yellow", 260, 150, 22, 110, 330, 800, 975, 1150),
  util("Reservoir"),
  street("Goldleaf Avenue", "yellow", 280, 150, 24, 120, 360, 850, 1025, 1200),
  { kind: "gotojail", name: "Go to Jail" },
  street("Fern Avenue", "green", 300, 200, 26, 130, 390, 900, 1100, 1275),
  street("Ivy Terrace", "green", 300, 200, 26, 130, 390, 900, 1100, 1275),
  chest,
  street("Evergreen Way", "green", 320, 200, 28, 150, 450, 1000, 1200, 1400),
  rail("Westgate Station"),
  chance,
  street("Skyline Drive", "navy", 350, 200, 35, 175, 500, 1100, 1300, 1500),
  { kind: "tax", name: "Luxury Tax", amount: 100 },
  street("Summit Heights", "navy", 400, 200, 50, 200, 600, 1400, 1700, 2000),
];

export const SIZE = BOARD.length;
export const JAIL = 10;
export const GO_TO_JAIL = 30;
export const GO_SALARY = 200;
export const JAIL_FINE = 50;
// The bank's buildings. Run out and nobody can build until some come back.
export const HOUSES = 32;
export const HOTELS = 12;

export type Buyable = Extract<Square, { price: number }>;
export const isBuyable = (sq: Square): sq is Buyable => sq.kind === "street" || sq.kind === "rail" || sq.kind === "util";
export const BUYABLE = BOARD.flatMap((sq, i) => (isBuyable(sq) ? [i] : []));
export const priceOf = (pos: number) => (BOARD[pos] as Buyable).price;
export const mortgageOf = (pos: number) => priceOf(pos) / 2;
// Lifting a mortgage costs it plus 10% interest, rounded up ($75 comes to $83).
export const unmortgageOf = (pos: number) => mortgageOf(pos) + Math.ceil(mortgageOf(pos) / 10);
export const houseCostOf = (pos: number) => {
  const sq = BOARD[pos];
  return sq.kind === "street" ? sq.house : 0;
};

// Every square of a group (a color, the stations, the utilities), in board order.
export const groupKey = (pos: number): string => {
  const sq = BOARD[pos];
  return sq.kind === "street" ? sq.group : sq.kind;
};
const GROUPS = new Map<string, number[]>();
for (const i of BUYABLE) GROUPS.set(groupKey(i), [...(GROUPS.get(groupKey(i)) ?? []), i]);
export const groupOf = (pos: number) => GROUPS.get(groupKey(pos)) ?? [];
export const GROUP_KEYS = [...GROUPS.keys()];
export const squaresIn = (key: string) => GROUPS.get(key) ?? [];
