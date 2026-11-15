import { everyOptionOn, type GameDef, type ModeDef, type Setting } from "../modeKit";
import { POWERS } from "./engine";
import { POWER_NAMES } from "./names";

export const GOLF_GAME = {
  name: "Golf",
  path: "/golf",
  reasons: { holes: { label: "Last hole played", push: "the last hole", won: "with the fewest strokes" } },
} as const satisfies GameDef;

const GENERATED_COURSE = { key: "course", is: [0] } as const;

const golf = (holes: number): Setting[] => [
  {
    key: "course",
    label: "Course",
    short: "{}",
    options: [
      { value: 0, label: "Generated" },
      { value: 1, label: "Bumper Plains" },
      { value: 2, label: "Cold Start" },
    ],
    default: 0,
  },
  {
    key: "holes",
    label: "Holes",
    short: "{} holes",
    options: [
      { value: 3, label: "3" },
      { value: 6, label: "6" },
      { value: 9, label: "9" },
      { value: 18, label: "18" },
    ],
    default: holes,
  },
  {
    key: "terrain",
    label: "Terrain",
    short: "{}",
    options: [
      { value: 0, label: "Grass" },
      { value: 1, label: "Ice" },
      { value: 2, label: "Both" },
    ],
    default: 0,
    when: GENERATED_COURSE,
  },
  {
    key: "style",
    label: "Holes like",
    short: "{} holes",
    options: [
      { value: 0, label: "Mini golf" },
      { value: 1, label: "Fairways" },
      { value: 2, label: "Both" },
    ],
    default: 2,
    when: GENERATED_COURSE,
  },
  {
    key: "hazards",
    label: "Hazards",
    short: "{} hazards",
    options: [
      { value: 0, label: "Few" },
      { value: 1, label: "Some" },
      { value: 2, label: "Lots" },
    ],
    default: 1,
    when: GENERATED_COURSE,
  },
  { key: "seed", label: "Seed", short: "Seed {}", options: [], default: 0, kind: "seed", when: GENERATED_COURSE },
  {
    key: "boxes",
    label: "Item boxes",
    short: "{} boxes",
    options: [
      { value: 0, label: "None" },
      { value: 1, label: "Few" },
      { value: 2, label: "Normal" },
      { value: 3, label: "Lots" },
    ],
    default: 2,
  },
  {
    key: "items",
    label: "Items",
    short: "{} items",
    options: POWERS.map((p, i) => ({ value: i, label: POWER_NAMES[p] })),
    default: everyOptionOn(POWERS.length),
    kind: "mask",
    when: { key: "boxes", is: [1, 2, 3] },
  },
  {
    key: "collide",
    label: "Ball hits",
    short: "Ball hits {}",
    options: [
      { value: 1, label: "On" },
      { value: 0, label: "Off" },
    ],
    default: 1,
  },
  {
    key: "mark",
    label: "Safe near the cup",
    short: "Safe near the cup: {}",
    options: [
      { value: 1, label: "On" },
      { value: 0, label: "Off" },
    ],
    default: 1,
    when: { key: "collide", is: [1] },
  },
];

const HOLES_FOR_A_DAY_OF_TURNS = 6;
const HOLES_LIVE = 9;

export const GOLF_MODES = {
  "golf:turns": {
    game: "golf",
    name: "Turn-based",
    title: "golf",
    kind: "async",
    players: 8,
    minPlayers: 2,
    board: "golf",
    slug: "turns",
    blurb:
      "One course, one shot at a time: whoever's farthest from the cup goes next. Knock each other about, and keep your items from hole to hole.",
    wants: "a round of golf",
    settings: [
      ...golf(HOLES_FOR_A_DAY_OF_TURNS),
      {
        key: "shotTime",
        label: "Time to shoot",
        short: "{} to shoot",
        options: [
          { value: 0, label: "No limit" },
          { value: 60, label: "1 hour" },
          { value: 240, label: "4 hours" },
          { value: 480, label: "8 hours" },
          { value: 1440, label: "1 day" },
        ],
        default: 0,
      },
    ],
  },
  "golf:live": {
    game: "golf",
    name: "Live",
    title: "live golf",
    kind: "realtime",
    players: 8,
    minPlayers: 2,
    board: "golf",
    slug: "live",
    blurb:
      "Everyone on the same hole at once. Shoot whenever you like, knock each other into the water, and sink it before the hole clock runs out.",
    wants: "a live round of golf",
    settings: [
      ...golf(HOLES_LIVE),
      {
        key: "holeTime",
        label: "Hole clock",
        short: "{} a hole",
        options: [
          { value: 2, label: "2 min" },
          { value: 3, label: "3 min" },
          { value: 5, label: "5 min" },
        ],
        default: 3,
      },
    ],
  },
} as const satisfies Record<`golf:${string}`, ModeDef>;
