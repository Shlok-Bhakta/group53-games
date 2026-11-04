// Journey Across Mereddia's cutscenes: the pigeon bringing the letter, the sword in the statue, the golem waking,
// the boulder being let loose, the oath months later. Each is a list of staging steps that the 3D view plays one
// after another over the map, with the game paused. The rules never wait on them: the engine only says which scene
// to play (`state.cut`), and the view tells it when the scene has been seen. Skipping jumps to the end.

export type Pt = { x: number; y: number };
// A place in the scene: a grid cell, or somebody ("hero", an entity such as "golem", a cast member such as "pigeon").
export type Aim = Pt | string;

export type Step =
  | { do: "cam"; at: Aim; dist?: number; pitch?: number; ms: number; shake?: number; wait?: boolean }
  | { do: "wait"; ms: number }
  | {
      do: "actor";
      who: string;
      // For somebody the scene makes up: which model to draw.
      model?: { kind: "characters" | "objects"; name: string };
      at?: Pt;
      // Height above the ground, in world units.
      y?: number;
      // Which way they face, in degrees: 0 south, 90 east, 180 north, -90 west.
      face?: number;
      scale?: number;
      // A gesture played once.
      shot?: string;
      // How long a move takes (or a gesture runs), and whether the scene waits for it.
      ms?: number;
      wait?: boolean;
      hide?: boolean;
    }
  | { do: "fx"; name: string; at: Aim; y?: number; toward?: number; hand?: boolean; secs?: number; tint?: [number, number, number]; size?: number }
  | { do: "sfx"; name: string }
  | { do: "fade"; to: 0 | 1; ms: number }
  | { do: "title"; text: string; ms: number }
  | { do: "bars"; on: boolean };

// How long the scene waits on a step.
export function stepMs(s: Step): number {
  switch (s.do) {
    case "cam":
      return s.wait === false ? 0 : s.ms;
    case "actor":
      return s.wait === false ? 0 : (s.ms ?? 0);
    case "wait":
    case "fade":
    case "title":
      return s.ms;
    default:
      return 0;
  }
}

// The Pigeon model's origin is 1.65 above its feet (it was made to fly), so its heights here are lower than they look.
const SOUTH = 0;
const EAST = 90;
const NORTH = 180;

// The old tree's middle: the tree is 2x2 tiles, placed on cell (34, 42) and covering the cells east and south of it.
const TREE = { x: 34.5, y: 42.5 };
// The branch it perches on: the tree's right-hand branch as you walk up to the tree from the north (east of the trunk), about three-quarters of a tile east of the middle, close in to the trunk.
const BRANCH = { x: TREE.x + 0.75, y: TREE.y };
// Back to the usual view, wherever the camera has been.
const BACK: Step = { do: "cam", at: "hero", ms: 900 };

export const CUTSCENES: Record<string, Step[]> = {
  // The letter: after a beat, a pigeon swoops in from the north, flies straight over Mallakoth without stopping, lets the
  // letter fall into his hands (he catches it), and carries on to the old tree, where it lands on its branch.
  intro: [
    { do: "bars", on: true },
    { do: "fade", to: 1, ms: 0 },
    { do: "cam", at: "hero", dist: 7, pitch: 0.5, ms: 0 },
    { do: "fade", to: 0, ms: 1400 },
    // A moment of quiet first, then the pigeon appears far off and comes straight at him (its head follows where it goes).
    { do: "wait", ms: 1000 },
    { do: "actor", who: "pigeon", model: { kind: "characters", name: "Pigeon" }, at: { x: 31, y: 10 }, y: 2.9, scale: 0.7 },
    { do: "wait", ms: 150 },
    { do: "sfx", name: "pigeon_flap" },
    { do: "cam", at: "hero", dist: 6.5, pitch: 0.5, ms: 3200, wait: false },
    { do: "actor", who: "pigeon", at: { x: 27, y: 24 }, y: 0.55, ms: 3200 },
    // Straight on, with no pause over his head: the next leg starts where this one ends, at about the same speed.
    { do: "actor", who: "pigeon", at: BRANCH, y: -0.03, ms: 4500, wait: false },
    { do: "actor", who: "pigeon", shot: "drop", ms: 500, wait: false },
    { do: "sfx", name: "pigeon_flap" },
    // The letter is the project's lined sheet of paper (note2), hand-sized. Its model floats 2.375 above its origin, so at 0.14
    // scale the paper is 0.33 above the y given here: it is let go from the pigeon (1.6) and falls into his hands (0.75), and
    // only when it lands is its sound played.
    { do: "actor", who: "letter", model: { kind: "objects", name: "note2" }, at: { x: 27, y: 24 }, y: 1.27, scale: 0.14 },
    { do: "actor", who: "letter", at: { x: 27, y: 24.4 }, y: 0.42, ms: 800, wait: false },
    { do: "wait", ms: 450 },
    { do: "actor", who: "hero", shot: "catch", ms: 0, wait: false },
    { do: "wait", ms: 350 },
    { do: "sfx", name: "Letter" },
    { do: "wait", ms: 650 },
    { do: "actor", who: "letter", hide: true },
    // The camera stays on him a moment more, and only then goes after the pigeon.
    { do: "wait", ms: 400 },
    { do: "cam", at: "pigeon", dist: 9, pitch: 0.5, ms: 2400, wait: false },
    { do: "wait", ms: 2700 },
    { do: "actor", who: "pigeon", hide: true },
    BACK,
    { do: "bars", on: false },
  ],

  // He burns the letter, as it asks: his own "fire" animation from the project, with the lined sheet of paper held in his
  // right hand and burning with the model's own burning frames.
  burn: [
    { do: "bars", on: true },
    { do: "cam", at: "hero", dist: 4.2, pitch: 0.62, ms: 700 },
    { do: "sfx", name: "Letter_Burn" },
    // Flames in his hands (on the paper in his lower hand): lit as the paper reaches the middle, and again as it burns down.
    { do: "actor", who: "hero", shot: "fire", ms: 550 },
    { do: "fx", name: "fire", at: "hero", hand: true, y: 0.15, size: 0.5, secs: 1.1 },
    { do: "wait", ms: 550 },
    { do: "fx", name: "fire", at: "hero", hand: true, y: 0.15, size: 0.65, secs: 1.3 },
    { do: "wait", ms: 600 },
    { do: "wait", ms: 400 },
    BACK,
    { do: "bars", on: false },
  ],

  // The old tree comes down and the pigeon, with nowhere to perch, takes off and flies away (if it hasn't made a home of his
  // head). A couple of seconds, with the camera held where it is and looking well down at the ground: a low camera, or one that
  // follows the bird up, shows the sky beyond the edge of the world as a blue band.
  flyaway: [
    { do: "bars", on: true },
    { do: "actor", who: "pigeon", model: { kind: "characters", name: "Pigeon" }, at: BRANCH, y: -0.03, face: NORTH, scale: 0.7 },
    { do: "cam", at: BRANCH, dist: 6, pitch: 0.75, ms: 400 },
    { do: "sfx", name: "pigeon_flap" },
    { do: "actor", who: "pigeon", at: { x: BRANCH.x + 8, y: BRANCH.y - 2 }, y: 1.4, ms: 2000, wait: false },
    { do: "wait", ms: 1700 },
    { do: "actor", who: "pigeon", hide: true },
    BACK,
    { do: "bars", on: false },
  ],

  // Vastios's swirl of light drops Mallakoth in the Slime Fields.
  arrive: [
    { do: "bars", on: true },
    { do: "fade", to: 1, ms: 0 },
    { do: "wait", ms: 500 },
    { do: "fx", name: "Teleport2", at: "hero", y: 0.1, size: 1.6 },
    { do: "sfx", name: "Magic_Crystal" },
    { do: "fade", to: 0, ms: 900 },
    { do: "cam", at: "hero", dist: 9, pitch: 0.8, ms: 900 },
    BACK,
    { do: "bars", on: false },
  ],

  // The sword in the statue's hands.
  sword: [
    { do: "bars", on: true },
    { do: "cam", at: "statue", dist: 8, pitch: 0.7, ms: 1000 },
    { do: "actor", who: "hero", face: NORTH, shot: "Grab_Sword_1", ms: 1000 },
    { do: "actor", who: "hero", shot: "Grab_Sword_2", ms: 900 },
    { do: "sfx", name: "Sword_Done" },
    { do: "fx", name: "Teleport2", at: "hero", y: 0.2, size: 1.2 },
    { do: "wait", ms: 700 },
    BACK,
    { do: "bars", on: false },
  ],

  // The golem is down: the slabs round its chamber draw back, and far off down the cave the stone door at the end of the hallway that leads to the
  // boulder opens too. (The door's own opening starts as the camera gets there; see the view.)
  golemdoor: [
    { do: "bars", on: true },
    { do: "cam", at: { x: 14.5, y: 46 }, dist: 9, pitch: 0.75, ms: 900 },
    { do: "wait", ms: 600 },
    { do: "sfx", name: "Stone_Wall_Open" },
    { do: "wait", ms: 900 },
    { do: "cam", at: { x: 13.5, y: 29 }, dist: 9, pitch: 0.75, ms: 1500 },
    { do: "sfx", name: "Stone_Wall_Open" },
    { do: "wait", ms: 1800 },
    BACK,
    { do: "bars", on: false },
  ],

  // The golem opens its eyes.
  golem: [
    { do: "bars", on: true },
    { do: "cam", at: "golem", dist: 10, pitch: 0.7, ms: 1100 },
    { do: "sfx", name: "AwakenGolem" },
    { do: "cam", at: "golem", dist: 9, pitch: 0.7, ms: 2200, shake: 0.2, wait: false },
    { do: "actor", who: "golem", shot: "awaken", ms: 2200 },
    { do: "fx", name: "smoke", at: "golem", y: 0.4, size: 2 },
    { do: "wait", ms: 500 },
    BACK,
    { do: "bars", on: false },
  ],

  // The slabs fall behind you, and far down the hall, something starts to roll.
  boulder: [
    { do: "bars", on: true },
    { do: "sfx", name: "Stone_Wall_Close" },
    { do: "cam", at: "hero", dist: 11, pitch: 0.8, ms: 600, shake: 0.2 },
    { do: "sfx", name: "Boulder_Roll" },
    { do: "cam", at: "boulder", dist: 12, pitch: 0.7, ms: 1300, shake: 0.22 },
    { do: "wait", ms: 500 },
    BACK,
    { do: "bars", on: false },
  ],

  // The altar rising out of the floor.
  altar: [
    { do: "bars", on: true },
    { do: "cam", at: { x: 21, y: 6.5 }, dist: 8, pitch: 0.7, ms: 900 },
    { do: "sfx", name: "Altar_slide" },
    { do: "cam", at: { x: 21, y: 6.5 }, dist: 7, pitch: 0.65, ms: 1500, shake: 0.08 },
    { do: "wait", ms: 400 },
    BACK,
    { do: "bars", on: false },
  ],

  // Months later: the four of them in the sanctum, the pair kneeling.
  oath: [
    { do: "bars", on: true },
    { do: "fade", to: 1, ms: 0 },
    { do: "cam", at: { x: 22, y: 9 }, dist: 8, pitch: 0.9, ms: 0 },
    { do: "title", text: "Several Months Later.", ms: 2800 },
    { do: "fade", to: 0, ms: 2000 },
    { do: "cam", at: { x: 22, y: 8.6 }, dist: 6.5, pitch: 0.85, ms: 2400 },
    { do: "bars", on: false },
  ],

  // Both put a hand in the sacred flame.
  flame: [
    { do: "bars", on: true },
    { do: "cam", at: { x: 21.5, y: 8 }, dist: 6.5, pitch: 0.85, ms: 1100 },
    { do: "title", text: "Flaminor Unum Lux!", ms: 1400 },
    { do: "sfx", name: "Sacred_Flame" },
    { do: "actor", who: "hero", shot: "touch_flame", ms: 0, wait: false },
    { do: "actor", who: "drawf", shot: "touch_flame", ms: 0, wait: false },
    { do: "actor", who: "vastios", shot: "touch_flame", ms: 0, wait: false },
    { do: "actor", who: "wilfred", shot: "touch_flame", ms: 1700 },
    { do: "fx", name: "Teleport2", at: { x: 21, y: 6.7 }, y: 1, tint: [0.7, 0.35, 1], size: 1.8 },
    { do: "fade", to: 1, ms: 800 },
    { do: "fade", to: 0, ms: 800 },
    { do: "bars", on: false },
  ],

  // The robes, held out and taken.
  robes: [
    { do: "bars", on: true },
    { do: "cam", at: { x: 22, y: 9 }, dist: 6.5, pitch: 0.85, ms: 900 },
    { do: "actor", who: "robes", model: { kind: "objects", name: "robes_mal" }, at: { x: 22, y: 8.9 }, y: 1.9, scale: 1.3 },
    { do: "actor", who: "vastios", shot: "drop_robe", ms: 0, wait: false },
    { do: "actor", who: "wilfred", shot: "drop_robe", ms: 0, wait: false },
    { do: "actor", who: "robes", at: { x: 22, y: 9.3 }, y: 0.9, ms: 1500 },
    { do: "actor", who: "hero", shot: "robe_grab", ms: 0, wait: false },
    { do: "actor", who: "drawf", shot: "robe_grab", ms: 1500 },
    { do: "actor", who: "robes", hide: true },
    { do: "bars", on: false },
  ],
};
