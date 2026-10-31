/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chess from "../chess.js";
import type * as chess_four_board from "../chess/four/board.js";
import type * as chess_four_classic from "../chess/four/classic.js";
import type * as chess_realtime from "../chess/realtime.js";
import type * as crons from "../crons.js";
import type * as games from "../games.js";
import type * as golf from "../golf.js";
import type * as golf_dmath from "../golf/dmath.js";
import type * as golf_engine from "../golf/engine.js";
import type * as golf_sandbox from "../golf/sandbox.js";
import type * as golf_scenarios from "../golf/scenarios.js";
import type * as golf_shapes from "../golf/shapes.js";
import type * as golf_world from "../golf/world.js";
import type * as http from "../http.js";
import type * as links from "../links.js";
import type * as matches from "../matches.js";
import type * as modes from "../modes.js";
import type * as notifications from "../notifications.js";
import type * as notify from "../notify.js";
import type * as poker from "../poker.js";
import type * as poker_cards from "../poker/cards.js";
import type * as poker_engine from "../poker/engine.js";
import type * as poker_text from "../poker/text.js";
import type * as presence from "../presence.js";
import type * as presenceConfig from "../presenceConfig.js";
import type * as previews from "../previews.js";
import type * as profileOptions from "../profileOptions.js";
import type * as profiles from "../profiles.js";
import type * as push from "../push.js";
import type * as ratings from "../ratings.js";
import type * as scrabble from "../scrabble.js";
import type * as scrabble_dictionary from "../scrabble/dictionary.js";
import type * as scrabble_engine from "../scrabble/engine.js";
import type * as scrabble_words from "../scrabble/words.js";
import type * as testing from "../testing.js";
import type * as time from "../time.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chess: typeof chess;
  "chess/four/board": typeof chess_four_board;
  "chess/four/classic": typeof chess_four_classic;
  "chess/realtime": typeof chess_realtime;
  crons: typeof crons;
  games: typeof games;
  golf: typeof golf;
  "golf/dmath": typeof golf_dmath;
  "golf/engine": typeof golf_engine;
  "golf/sandbox": typeof golf_sandbox;
  "golf/scenarios": typeof golf_scenarios;
  "golf/shapes": typeof golf_shapes;
  "golf/world": typeof golf_world;
  http: typeof http;
  links: typeof links;
  matches: typeof matches;
  modes: typeof modes;
  notifications: typeof notifications;
  notify: typeof notify;
  poker: typeof poker;
  "poker/cards": typeof poker_cards;
  "poker/engine": typeof poker_engine;
  "poker/text": typeof poker_text;
  presence: typeof presence;
  presenceConfig: typeof presenceConfig;
  previews: typeof previews;
  profileOptions: typeof profileOptions;
  profiles: typeof profiles;
  push: typeof push;
  ratings: typeof ratings;
  scrabble: typeof scrabble;
  "scrabble/dictionary": typeof scrabble_dictionary;
  "scrabble/engine": typeof scrabble_engine;
  "scrabble/words": typeof scrabble_words;
  testing: typeof testing;
  time: typeof time;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
