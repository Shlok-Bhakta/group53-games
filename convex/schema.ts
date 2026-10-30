import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  // Convex Auth rewrites name, image, and discordUsername from Discord on every sign-in.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    discordUsername: v.optional(v.string()),
    // Load-test and e2e players. They never receive pushes and never trigger pushes to real players.
    isTest: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
  // Cosmetics live apart from users so a Discord sync never clobbers them.
  profiles: defineTable({
    userId: v.id("users"),
    frame: v.string(),
    frameColor: v.string(),
    glow: v.boolean(),
    effect: v.string(),
    badge: v.string(),
    tagline: v.string(),
  }).index("by_user", ["userId"]),
  // One row per player: heartbeat for the online dot. Taps live in their own table so tapping and the
  // heartbeat never write the same document.
  presence: defineTable({
    userId: v.id("users"),
    online: v.boolean(),
    lastSeen: v.number(),
    path: v.string(),
    tap: v.optional(v.object({ x: v.number(), y: v.number(), path: v.string(), seq: v.number() })),
  }).index("by_user", ["userId"]),
  taps: defineTable({ userId: v.id("users"), x: v.number(), y: v.number(), path: v.string(), seq: v.number() }).index("by_user", ["userId"]),
  // One row per game of anything. `state` is mode-specific (see convex/chess.ts).
  matches: defineTable({
    mode: v.string(),
    status: v.union(v.literal("waiting"), v.literal("active"), v.literal("finished"), v.literal("cancelled")),
    createdBy: v.id("users"),
    // Seats in join order. For chess, color is assigned when the game starts.
    players: v.array(v.object({ userId: v.id("users"), color: v.optional(v.string()) })),
    // Challenges are invite-only; open lobbies leave this empty.
    invited: v.array(v.id("users")),
    // A challenge that invited fewer players than it has seats: anyone can take the rest.
    openSeats: v.optional(v.boolean()),
    // The host's choices from the mode's settings (convex/modes.ts), only the ones that differ from the
    // defaults. Read them with settingsOf().
    settings: v.optional(v.record(v.string(), v.number())),
    state: v.any(),
    // Async modes: whose move it is, and how many moves have been made (reminders check it hasn't changed).
    turn: v.optional(v.id("users")),
    moveCount: v.number(),
    drawOffer: v.optional(v.id("users")),
    result: v.optional(
      // `standings` (four-player): places best first, ties sharing a place.
      v.object({ winners: v.array(v.id("users")), draw: v.boolean(), reason: v.string(), standings: v.optional(v.array(v.array(v.id("users")))) }),
    ),
    ratingChanges: v.optional(v.array(v.object({ userId: v.id("users"), before: v.number(), after: v.number() }))),
    rematchOf: v.optional(v.id("matches")),
    // An in-place rematch offer on a finished game. Once every player is in (`yes`), a new game starts with
    // colors moved one seat along.
    rematch: v.optional(
      v.object({
        by: v.id("users"),
        yes: v.optional(v.array(v.id("users"))),
        at: v.number(),
        status: v.union(v.literal("pending"), v.literal("declined"), v.literal("accepted")),
        matchId: v.optional(v.id("matches")),
      }),
    ),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    lastActivityAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_mode_status", ["mode", "status"])
    .index("by_creator_status", ["createdBy", "status"]),
  // Real-time chess inputs, one row each. Moves only ever insert here, so two players moving at once
  // never conflict.
  rtCommands: defineTable({
    matchId: v.id("matches"),
    tick: v.number(),
    color: v.string(),
    pieceId: v.number(),
    toX: v.number(),
    toY: v.number(),
    kind: v.optional(v.union(v.literal("move"), v.literal("cancel"), v.literal("resign"))),
  }).index("by_match_tick", ["matchId", "tick"]),
  // A settled board state for each real-time game, advanced by chess:rtTick, so replays start near now.
  rtSnapshots: defineTable({ matchId: v.id("matches"), state: v.any() }).index("by_match", ["matchId"]),
  // Golf's open world (convex/golf.ts): one row per world. `awake` while the server is settling it.
  golfWorlds: defineTable({ key: v.string(), startAt: v.number(), awake: v.boolean(), collide: v.boolean() }).index("by_key", ["key"]),
  // Everyone who's played in a world, for names and colors.
  golfPlayers: defineTable({ worldId: v.id("golfWorlds"), userId: v.id("users"), joinedAt: v.number() }).index("by_world", ["worldId"]),
  // Everything anyone does, one row each, stamped with the tick they did it on. Acting only ever inserts
  // here, so players acting at once never conflict.
  golfCommands: defineTable({
    worldId: v.id("golfWorlds"),
    tick: v.number(),
    by: v.id("users"),
    seq: v.number(),
    kind: v.union(v.literal("join"), v.literal("shot"), v.literal("use"), v.literal("fire"), v.literal("hop"), v.literal("brake"), v.literal("reset")),
    a: v.optional(v.number()),
    p: v.optional(v.number()),
    i: v.optional(v.number()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
  }).index("by_world_tick", ["worldId", "tick"]),
  // The settled world (convex/golf/world.ts, packed), advanced by golf:tick, so phones replay from near now.
  golfSnapshots: defineTable({ worldId: v.id("golfWorlds"), tick: v.number(), state: v.any() }).index("by_world", ["worldId"]),
  // What players mustn't see: a player's own hand (`userId` set; a Scrabble rack) or the game's (no
  // `userId`; the tile bag). Only ever returned to its owner.
  secrets: defineTable({ matchId: v.id("matches"), userId: v.optional(v.id("users")), data: v.any() }).index("by_match_user", ["matchId", "userId"]),
  // A player's plan for their next turn (tiles laid out on the board, rack order), saved as they go so it's
  // there when they come back. Private to them; others only see that they're planning.
  drafts: defineTable({ matchId: v.id("matches"), userId: v.id("users"), data: v.any(), count: v.number(), at: v.number() }).index("by_match_user", ["matchId", "userId"]),
  // Game links opened outside the app, sent on to the player's phone as a push (convex/links.ts). Kept
  // to rate-limit them.
  handoffs: defineTable({ userId: v.id("users"), matchId: v.id("matches"), at: v.number() }).index("by_user", ["userId"]),
  // Elo per mode.
  ratings: defineTable({
    userId: v.id("users"),
    mode: v.string(),
    rating: v.number(),
    games: v.number(),
    wins: v.number(),
    losses: v.number(),
    draws: v.number(),
  })
    .index("by_mode", ["mode"])
    .index("by_user_mode", ["userId", "mode"]),
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),
});
