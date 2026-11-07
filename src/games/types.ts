import type { MatchView } from "../../convex/matches";

// One seat at a game, as every game screen gets it.
export type Player = MatchView["players"][number];
