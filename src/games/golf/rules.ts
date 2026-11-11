import type { ModeKey, Settings } from "../../../convex/modes";

const hours = (m: number) => (m === 60 ? "an hour" : m === 1440 ? "a day" : `${m / 60} hours`);
const COURSE = ["holes generated from the seed", "Bumper Plains, made by hand", "Cold Start, made by hand on ice"];

// How to play golf, with the game's settings filled in.
export function golfRules(mode: ModeKey, s: Settings): string[] {
  const live = mode === "golf:live";
  const hits = s.collide !== 0;
  return [
    `2 to 8 players, ${s.holes ?? 9} holes on ${COURSE[s.course ?? 0]}. Fewest strokes over the round wins.`,
    "Drag back from anywhere and let go to putt: the further you pull, the harder you hit. Water and the void cost a stroke and put you back where you hit from.",
    live
      ? `Everyone plays the hole at once. You've ${s.holeTime ?? 3} minutes: whoever's still out when the clock runs out picks up with two more strokes.`
      : "One shot at a time. Whoever's farthest from the cup goes next, like real golf; on the tee, whoever did best on the last hole goes first.",
    `Take par plus four and you pick up. Your ball's done once it's in; watch everyone else finish.`,
    s.boxes === 0
      ? "No item boxes this game."
      : `Roll through a box for an item. You hold three, and ${live ? "they" : "whatever you hold"} come with you to the next hole. Use them before your shot${live ? "" : " on your turn"}.`,
    hits
      ? `Balls knock into each other. Getting knocked never costs you a stroke: knocked into the water, you go back where you were.${s.mark !== 0 ? " Balls sitting close to the cup are marked, so nobody can knock them away (items still can)." : ""}`
      : "Balls roll straight through each other this game. Items still reach other players.",
    ...(live ? [] : [`We ping you when it's your shot. Leave it ${hours(s.shotTime ?? 480)} and your caddie putts for you; three in a row and they keep at it till you're back.`]),
  ];
}
