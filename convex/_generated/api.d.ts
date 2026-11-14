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
import type * as devAuth from "../devAuth.js";
import type * as devCrew from "../devCrew.js";
import type * as games from "../games.js";
import type * as golf from "../golf.js";
import type * as golf_battle from "../golf/battle.js";
import type * as golf_bot from "../golf/bot.js";
import type * as golf_build from "../golf/build.js";
import type * as golf_coldstart from "../golf/coldstart.js";
import type * as golf_distance from "../golf/distance.js";
import type * as golf_dmath from "../golf/dmath.js";
import type * as golf_engine from "../golf/engine.js";
import type * as golf_gen from "../golf/gen.js";
import type * as golf_holes from "../golf/holes.js";
import type * as golf_names from "../golf/names.js";
import type * as golf_plains from "../golf/plains.js";
import type * as golf_round from "../golf/round.js";
import type * as golf_sandbox from "../golf/sandbox.js";
import type * as golf_scenarios from "../golf/scenarios.js";
import type * as golf_shapes from "../golf/shapes.js";
import type * as golf_solutions from "../golf/solutions.js";
import type * as golf_world from "../golf/world.js";
import type * as hosted from "../hosted.js";
import type * as http from "../http.js";
import type * as landlord from "../landlord.js";
import type * as landlord_board from "../landlord/board.js";
import type * as landlord_bot from "../landlord/bot.js";
import type * as landlord_cards from "../landlord/cards.js";
import type * as landlord_engine from "../landlord/engine.js";
import type * as landlord_text from "../landlord/text.js";
import type * as lib_drafts from "../lib/drafts.js";
import type * as lib_people from "../lib/people.js";
import type * as lib_seats from "../lib/seats.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_turns from "../lib/turns.js";
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
import type * as stonks from "../stonks.js";
import type * as stonks_board from "../stonks/board.js";
import type * as stonks_market from "../stonks/market.js";
import type * as stonks_profile from "../stonks/profile.js";
import type * as stonks_trade from "../stonks/trade.js";
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
  devAuth: typeof devAuth;
  devCrew: typeof devCrew;
  games: typeof games;
  golf: typeof golf;
  "golf/battle": typeof golf_battle;
  "golf/bot": typeof golf_bot;
  "golf/build": typeof golf_build;
  "golf/coldstart": typeof golf_coldstart;
  "golf/distance": typeof golf_distance;
  "golf/dmath": typeof golf_dmath;
  "golf/engine": typeof golf_engine;
  "golf/gen": typeof golf_gen;
  "golf/holes": typeof golf_holes;
  "golf/names": typeof golf_names;
  "golf/plains": typeof golf_plains;
  "golf/round": typeof golf_round;
  "golf/sandbox": typeof golf_sandbox;
  "golf/scenarios": typeof golf_scenarios;
  "golf/shapes": typeof golf_shapes;
  "golf/solutions": typeof golf_solutions;
  "golf/world": typeof golf_world;
  hosted: typeof hosted;
  http: typeof http;
  landlord: typeof landlord;
  "landlord/board": typeof landlord_board;
  "landlord/bot": typeof landlord_bot;
  "landlord/cards": typeof landlord_cards;
  "landlord/engine": typeof landlord_engine;
  "landlord/text": typeof landlord_text;
  "lib/drafts": typeof lib_drafts;
  "lib/people": typeof lib_people;
  "lib/seats": typeof lib_seats;
  "lib/secrets": typeof lib_secrets;
  "lib/turns": typeof lib_turns;
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
  stonks: typeof stonks;
  "stonks/board": typeof stonks_board;
  "stonks/market": typeof stonks_market;
  "stonks/profile": typeof stonks_profile;
  "stonks/trade": typeof stonks_trade;
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
